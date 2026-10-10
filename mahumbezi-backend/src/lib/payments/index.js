const db = require("../db");
const { mode, currency, normalizeMsisdn, positiveInt } = require("./config");

/**
 * Every "Paid" order goes through here, regardless of method.
 *
 * Cash and Card are physical: there's no external system to call, so the
 * transaction is recorded as `succeeded` immediately — the staff member is
 * asserting the money already changed hands.
 *
 * Mobile Money behaves differently depending on PAYMENT_PROVIDER_MODE:
 *
 *   mock  (default) — same as Cash: a staff-asserted payment, logged with
 *         provider "mock" so it's never mistaken for one a gateway verified.
 *   live  — a real MTN MoMo / Airtel Money collection is pushed to the
 *         customer's phone. The row starts as `pending`, the customer
 *         approves on their handset, and we poll until it settles. The order
 *         is NOT marked Paid until the gateway says SUCCESSFUL.
 *
 * The seam a gateway plugs into is the provider interface (mtnMomo.js,
 * airtel.js):
 *
 *   charge({ orderId, amount, currency, phone }) -> { reference }
 *   status(reference)                            -> { status, message? }
 *                                                   status: 'pending' | 'succeeded' | 'failed'
 */

const METHOD_TO_PROVIDER = {
  Cash: "cash",
  Card: "card",
  "MTN MoMo": "mtn_momo",
  "Airtel Money": "airtel_money",
  // Kept so a stale browser tab, or a ledger row written before the two
  // networks were offered separately, still resolves. The cashier's screen
  // now offers each network by name.
  "Mobile Money": "mobile_money",
};

// Only these roles may take money. Enforced at the route, kept next to the
// ledger so the rule and the data live together.
const PAYMENT_ROLES = ["Cashier", "Admin", "Manager"];

// The methods that push a prompt to a customer's handset and therefore need
// a phone number. Cash and Card settle in the room, so they never do.
const MOBILE_MONEY_METHODS = ["MTN MoMo", "Airtel Money", "Mobile Money"];

// Cash and Card are physical: the staff member is asserting the money already
// changed hands, so there is no gateway to call. Named explicitly rather than
// by testing "isn't mobile money", because the mobile-money methods are
// identified by their own provider names — inferring offline from anything
// else silently books money that was never collected.
const OFFLINE_PROVIDERS = new Set(["cash", "card"]);

const insertTx = db.prepare(
  `INSERT INTO payment_transactions
     (order_id, provider, provider_reference, amount, status, method, currency, customer_phone, taken_by, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
);

const selectTx = db.prepare("SELECT * FROM payment_transactions WHERE id = ?");

const updateTxStatus = db.prepare(
  `UPDATE payment_transactions
      SET status = ?, provider_reference = COALESCE(?, provider_reference), error = ?, updated_at = datetime('now')
    WHERE id = ?`
);

const updateTxReference = db.prepare(
  "UPDATE payment_transactions SET provider_reference = ?, updated_at = datetime('now') WHERE id = ?"
);

// A gateway may settle in a different currency than the one we asked for (the
// MTN sandbox only accepts EUR). Record what was really sent so the ledger
// does not claim an amount the provider never saw.
const updateTxCurrency = db.prepare(
  "UPDATE payment_transactions SET currency = ?, updated_at = datetime('now') WHERE id = ?"
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function insert({ orderId, provider, status, amount, method, currencyCode, phone, userId }) {
  const info = insertTx.run(
    orderId,
    provider,
    null,
    amount,
    status,
    method,
    currencyCode,
    phone ? normalizeMsisdn(phone) : null,
    userId != null ? userId : null
  );
  return selectTx.get(info.lastInsertRowid);
}

function settle(txId, result) {
  updateTxStatus.run(result.status, null, result.message || null, txId);
  return selectTx.get(txId);
}

/**
 * Which gateway module backs a given provider name.
 *
 * Each network is named directly, so MTN MoMo and Airtel Money can be live
 * at the same time — the cashier picks the network per payment and nothing
 * depends on a single global MOBILE_MONEY_PROVIDER. That env var is only
 * consulted for the legacy "Mobile Money" method, which carries no network
 * of its own. Returns null for anything that isn't a mobile-money provider.
 */
function liveProviderFor(providerName) {
  if (providerName === "mtn_momo") return require("./mtnMomo");
  if (providerName === "airtel_money") return require("./airtel");
  if (providerName !== "mobile_money") return null;

  const which = (process.env.MOBILE_MONEY_PROVIDER || "").toLowerCase();
  if (which === "mtn_momo") return require("./mtnMomo");
  if (which === "airtel_money") return require("./airtel");
  throw new Error(
    'The legacy "Mobile Money" method needs MOBILE_MONEY_PROVIDER set to "mtn_momo" or "airtel_money". ' +
      'Newer clients send "MTN MoMo" or "Airtel Money" instead.'
  );
}

/**
 * Ask the gateway for the current state of a still-pending transaction until
 * it reaches a terminal state or the time budget runs out.
 * Returns the updated row, or null if it's still pending when the budget is
 * exhausted (the caller keeps polling later — see routes/payments.js).
 */
async function pollToSettled({ provider, reference, txId }) {
  const budgetMs = positiveInt("PAYMENT_SETTLE_BUDGET_MS", 15000);
  const intervalMs = positiveInt("PAYMENT_POLL_INTERVAL_MS", 2000);
  const deadline = Date.now() + budgetMs;

  for (;;) {
    const result = await provider.status(reference);
    if (result.status !== "pending") return settle(txId, result);
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

/**
 * Record a payment attempt against an order.
 *
 * Returns the payment_transactions row. Its `status` is what the caller must
 * branch on:
 *   'succeeded' -> safe to mark the order Paid
 *   'pending'   -> the customer hasn't approved yet; leave the order unpaid
 *                  and poll via GET /api/payments/:id
 * Throws if a real gateway rejected the request outright — the order is not
 * marked Paid.
 */
async function recordPayment({ orderId, method, amount, phone, userId }) {
  const providerName = METHOD_TO_PROVIDER[method];
  if (!providerName) throw new Error(`Unknown payment method: ${method}`);
  const currencyCode = currency();

  // Cash and Card never go through an external gateway — nothing to call,
  // the money already changed hands physically.
  if (OFFLINE_PROVIDERS.has(providerName)) {
    return insert({
      orderId,
      provider: providerName,
      status: "succeeded",
      amount,
      method,
      currencyCode,
      phone,
      userId,
    });
  }

  if (mode() !== "live") {
    return insert({
      orderId,
      provider: "mock",
      status: "succeeded",
      amount,
      method,
      currencyCode,
      phone,
      userId,
    });
  }

  const provider = liveProviderFor(providerName);
  // The row exists before the network call so a crash mid-charge leaves a
  // pending row to reconcile rather than nothing at all.
  const tx = insert({
    orderId,
    provider: provider.name,
    status: "pending",
    amount,
    method,
    currencyCode,
    phone,
    userId,
  });

  let reference;
  try {
    const charged = await provider.charge({ orderId, amount, currency: currencyCode, phone });
    reference = charged.reference;
    if (charged.currency && charged.currency !== currencyCode) {
      updateTxCurrency.run(charged.currency, tx.id);
    }
  } catch (err) {
    settle(tx.id, { status: "failed", message: err.message });
    throw err;
  }
  updateTxReference.run(reference, tx.id);

  return (await pollToSettled({ provider, reference, txId: tx.id })) || selectTx.get(tx.id);
}

/**
 * Re-check a transaction with its gateway. No-op for cash/card/mock or for
 * one that has already settled — this is what GET /api/payments/:id calls on
 * each poll from the cashier's screen.
 */
async function refreshTransaction(tx) {
  if (tx.status !== "pending" || mode() !== "live") return tx;
  if (!tx.provider_reference) return tx;
  const provider = liveProviderFor(tx.provider);
  if (!provider) return tx;
  const result = await provider.status(tx.provider_reference);
  return result.status === "pending" ? tx : settle(tx.id, result);
}

function getTransaction(id) {
  return selectTx.get(id) || null;
}

/**
 * Ledger view for the Sales & Payments screen: one row per payment attempt,
 * newest first, with the order's table/total alongside.
 */
function listTransactions({ limit = 100, orderId } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const params = [];
  let where = "";
  if (orderId) {
    where = "WHERE p.order_id = ?";
    params.push(orderId);
  }
  params.push(capped);
  return db
    .prepare(
      `SELECT p.*,
              o.table_name AS table_name,
              o.status     AS order_status,
              o.total      AS order_total,
              u.name       AS taken_by_name
         FROM payment_transactions p
         LEFT JOIN orders o    ON o.id = p.order_id
         LEFT JOIN users   u    ON u.id = p.taken_by
         ${where}
        ORDER BY p.id DESC
        LIMIT ?`
    )
    .all(...params);
}

module.exports = {
  PAYMENT_ROLES,
  MOBILE_MONEY_METHODS,
  METHOD_TO_PROVIDER,
  recordPayment,
  refreshTransaction,
  getTransaction,
  listTransactions,
  normalizeMsisdn,
  currency,
  mode,
};
