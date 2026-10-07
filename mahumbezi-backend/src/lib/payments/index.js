const db = require("../db");

/**
 * Every "Paid" order goes through here, regardless of method. For Cash and
 * Card, that just means recording what the staff member already collected
 * in person — there's no external system to call. For Mobile Money, this is
 * the seam where a real MTN MoMo / Airtel Money integration plugs in once
 * the restaurant has real merchant credentials (see mtnMomo.js / airtel.js).
 *
 * Until then, PAYMENT_PROVIDER_MODE stays "mock" (the default) and Mobile
 * Money is recorded the same way Cash/Card are: the staff member is
 * asserting payment was received, and that assertion is logged with a
 * provider of "mock" so it's easy to find in payment_transactions later and
 * is never confused with a transaction a real gateway actually verified.
 */

const insertTransaction = db.prepare(
  `INSERT INTO payment_transactions (order_id, provider, provider_reference, amount, status)
   VALUES (?, ?, ?, ?, ?)`
);

const METHOD_TO_PROVIDER = {
  Cash: "cash",
  Card: "card",
  "Mobile Money": "mobile_money",
};

function mode() {
  return (process.env.PAYMENT_PROVIDER_MODE || "mock").toLowerCase();
}

/**
 * Record a payment against an order. Returns the inserted
 * payment_transactions row. Throws if a real gateway is configured and the
 * charge fails — callers should not mark the order Paid until this resolves.
 */
async function recordPayment({ orderId, method, amount }) {
  const providerName = METHOD_TO_PROVIDER[method] || "mock";

  // Cash and Card never go through an external gateway — there's nothing
  // to call, the money already changed hands physically.
  if (providerName === "cash" || providerName === "card" || mode() === "mock") {
    const info = insertTransaction.run(orderId, providerName === "mobile_money" ? "mock" : providerName, null, amount, "succeeded");
    return db.prepare("SELECT * FROM payment_transactions WHERE id = ?").get(info.lastInsertRowid);
  }

  // mode() === "live": route Mobile Money through the configured real
  // gateway. Both providers currently throw "not implemented" — see
  // src/lib/payments/README.md for what's needed to finish either one.
  const provider = mode() === "live" ? requireLiveProvider() : null;
  const result = await provider.charge({ orderId, amount });
  const info = insertTransaction.run(
    orderId,
    result.provider,
    result.reference || null,
    amount,
    result.status
  );
  return db.prepare("SELECT * FROM payment_transactions WHERE id = ?").get(info.lastInsertRowid);
}

function requireLiveProvider() {
  const which = (process.env.MOBILE_MONEY_PROVIDER || "").toLowerCase();
  if (which === "mtn_momo") return require("./mtnMomo");
  if (which === "airtel_money") return require("./airtel");
  throw new Error(
    'PAYMENT_PROVIDER_MODE=live requires MOBILE_MONEY_PROVIDER to be set to "mtn_momo" or "airtel_money"'
  );
}

module.exports = { recordPayment };
