const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { isNonNegativeNumber, isPositiveInt } = require("../lib/validate");
const cache = require("../lib/reportCache");
const audit = require("../lib/audit");
const payments = require("../lib/payments");
const { loadOrder, markOrderPaid } = require("../lib/orderPaid");

const router = express.Router();
router.use(requireAuth);

// Full lifecycle including the guest-facing statuses (Received/Accepted/
// Ready) that customer QR orders start and move through; staff POS orders
// still begin at "Preparing".
const VALID_STATUSES = ["Received", "Accepted", "Preparing", "Ready", "Served", "Paid"];
// MTN MoMo and Airtel Money are separate methods so the cashier says which
// network is charging, and the ledger names it. "Mobile Money" without a
// network is still accepted for older clients; it resolves to whichever
// provider MOBILE_MONEY_PROVIDER names.
const VALID_METHODS = ["Cash", "Card", "MTN MoMo", "Airtel Money", "Mobile Money"];
const VALID_DISCOUNT_TYPES = ["percent", "fixed"];

// A partial unique index (migration 012) already stops a second *succeeded*
// payment from being written for one order; this turns the resulting SQLite
// error into a clean 409 instead of a 500 when two requests race.
function isUniqueViolation(err) {
  return String((err && err.code) || "").startsWith("SQLITE_CONSTRAINT");
}

// How much of each inventory item one unit of a menu item consumes,
// keyed by menu_item_id, only for menu items that actually have a recipe.
function loadIngredientMap(menuItemIds) {
  if (menuItemIds.length === 0) return new Map();
  const placeholders = menuItemIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT menu_item_id, inventory_item_id, qty_per_order
       FROM menu_item_ingredients WHERE menu_item_id IN (${placeholders})`
    )
    .all(...menuItemIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.menu_item_id)) map.set(r.menu_item_id, []);
    map.get(r.menu_item_id).push(r);
  }
  return map;
}

router.get("/", (req, res) => {
  const { status } = req.query;
  let rows;
  if (status && VALID_STATUSES.includes(status)) {
    rows = db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY id DESC").all(status);
  } else {
    rows = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
  }
  const withItems = rows.map((o) => ({
    ...o,
    items: db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(o.id),
  }));
  res.json(withItems);
});

router.get("/:id", (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// Create a new order.
// Body: {
//   tableName: "T3",
//   items: [{ menuItemId, name, price, qty }, ...],
//   discount: { type: "percent" | "fixed", value: number } (optional)
// }
// Subtotal/discount/tax/total are all computed server-side — never trust a
// client-sent amount for money. Selling an item with a defined recipe
// (menu_item_ingredients) also deducts the matching inventory.
router.post("/", (req, res) => {
  const { tableName, items, discount } = req.body || {};
  if (!tableName || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "tableName and a non-empty items array are required" });
  }
  const tableExists = db.prepare("SELECT 1 AS present FROM tables WHERE name = ?").get(tableName);
  if (!tableExists) {
    return res.status(400).json({ error: `Table "${tableName}" does not exist` });
  }
  for (const it of items) {
    if (typeof it.name !== "string" || !it.name.trim()) {
      return res.status(400).json({ error: "each item needs a name" });
    }
    if (!isNonNegativeNumber(it.price)) {
      return res.status(400).json({ error: `item "${it.name}": price must be a non-negative number` });
    }
    if (!isPositiveInt(it.qty)) {
      return res.status(400).json({ error: `item "${it.name}": qty must be a positive whole number` });
    }
  }

  let discountType = null;
  let discountValue = 0;
  if (discount != null) {
    if (!VALID_DISCOUNT_TYPES.includes(discount.type)) {
      return res.status(400).json({ error: `discount.type must be one of: ${VALID_DISCOUNT_TYPES.join(", ")}` });
    }
    if (!isNonNegativeNumber(discount.value)) {
      return res.status(400).json({ error: "discount.value must be a non-negative number" });
    }
    if (discount.type === "percent" && Number(discount.value) > 100) {
      return res.status(400).json({ error: "discount.value cannot exceed 100 for a percent discount" });
    }
    discountType = discount.type;
    discountValue = Number(discount.value);
  }

  const settings = db.prepare("SELECT vat_rate FROM settings WHERE id = 1").get();
  const vatRate = settings ? settings.vat_rate : 18;

  const subtotal = items.reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);
  let discountAmount = 0;
  if (discountType === "percent") {
    discountAmount = Math.round(subtotal * (discountValue / 100));
  } else if (discountType === "fixed") {
    discountAmount = Math.round(discountValue);
  }
  discountAmount = Math.min(discountAmount, subtotal); // never discount past zero
  const taxableAmount = subtotal - discountAmount;
  const tax = Math.round(taxableAmount * (vatRate / 100));
  const total = taxableAmount + tax;

  const insertOrder = db.prepare(
    `INSERT INTO orders (table_name, status, subtotal, tax, total, discount_type, discount_value, discount_amount)
     VALUES (?, 'Preparing', ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES (?, ?, ?, ?, ?)`
  );
  const markTableOccupied = db.prepare(
    `UPDATE tables SET status = 'Occupied' WHERE name = ? AND status != 'Occupied'`
  );
  const deductInventory = db.prepare(
    `UPDATE inventory_items SET qty = qty - ?, updated_at = datetime('now') WHERE id = ?`
  );

  const menuItemIds = items.filter((it) => it.menuItemId).map((it) => Number(it.menuItemId));
  const ingredientMap = loadIngredientMap(menuItemIds);

  const createOrder = db.transaction(() => {
    const info = insertOrder.run(tableName, subtotal, tax, total, discountType, discountValue, discountAmount);
    const orderId = info.lastInsertRowid;
    for (const it of items) {
      insertItem.run(orderId, it.menuItemId || null, it.name, Number(it.price), Number(it.qty));
      // Deduct any inventory this menu item is recipe-linked to. Purely
      // best-effort bookkeeping — allowed to go negative (shows as "Out of
      // Stock" rather than blocking the sale; the till isn't the place to
      // stop a waiter serving a guest over a stock-count mismatch).
      const ingredients = ingredientMap.get(Number(it.menuItemId)) || [];
      for (const ing of ingredients) {
        deductInventory.run(ing.qty_per_order * Number(it.qty), ing.inventory_item_id);
      }
    }
    markTableOccupied.run(tableName);
    return orderId;
  });

  const orderId = createOrder();
  cache.invalidate();
  audit.log(req, "order.create", { entity: "order", entityId: orderId, detail: `${tableName} · ${total}` });
  res.status(201).json(loadOrder(orderId));
});

// Update status (Received -> Accepted -> Preparing -> Ready -> Served ->
// Paid). Paid requires a payment method and the Cashier/Admin/Manager role.
//
// Marking an order Paid also frees its table (unless another open order is
// still on it), records a payment_transactions row (src/lib/payments), and
// records an ebm_invoices row (src/lib/ebm — not real fiscalisation yet).
//
// Guards that matter here:
//   * an order already in Paid can neither be paid again nor moved back out
//     of Paid. Paying twice would double-record revenue; moving *out* of Paid
//     would silently remove it from revenue while its payment row stays in
//     the ledger. Reversing money needs a refund flow, which doesn't exist.
//   * the "already paid" check is re-done inside the DB transaction by
//     markOrderPaid, so two simultaneous clicks cannot both win.
router.patch("/:id/status", async (req, res) => {
  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Order not found" });

  const { status, method, phone } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }

  if (status === "Paid") {
    if (!method || !VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(", ")} when marking an order Paid` });
    }
    if (!payments.PAYMENT_ROLES.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `Only ${payments.PAYMENT_ROLES.join(", ")} can record payments`, code: "FORBIDDEN" });
    }
    if (existing.status === "Paid") {
      return res.status(409).json({ error: "Order is already paid", code: "ALREADY_PAID" });
    }

    const customerPhone = String(phone || "").trim() || String(existing.phone || "").trim();
    const needsPhone = payments.MOBILE_MONEY_METHODS.includes(method);
    if (needsPhone && payments.mode() === "live" && !customerPhone) {
      return res
        .status(400)
        .json({ error: `A customer phone number is required to push an ${method} payment request` });
    }

    // Payment recording can involve a real network call to a gateway (see
    // src/lib/payments), so it happens before the synchronous DB transaction.
    let tx;
    try {
      tx = await payments.recordPayment({
        orderId: existing.id,
        method,
        amount: existing.total,
        phone: customerPhone,
        userId: req.user.id,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: "Order is already paid", code: "ALREADY_PAID" });
      }
      return res.status(502).json({ error: `Payment could not be recorded: ${err.message}` });
    }

    // Live Mobile Money: the customer hasn't approved on their handset yet.
    // The order stays unpaid; the cashier polls GET /api/payments/:id, which
    // settles the order as soon as the gateway confirms.
    if (tx.status === "pending") {
      return res.status(202).json({
        pending: true,
        code: "AWAITING_CUSTOMER",
        message: `Payment request sent — waiting for the customer to approve on ${customerPhone}`,
        transactionId: tx.id,
        orderId: existing.id,
      });
    }
    if (tx.status !== "succeeded") {
      return res
        .status(502)
        .json({ error: tx.error || "Payment failed", code: "PAYMENT_FAILED", transactionId: tx.id });
    }

    try {
      return res.json(markOrderPaid(existing.id, method, req));
    } catch (err) {
      if (err.code === "ALREADY_PAID") {
        return res.status(409).json({ error: "Order is already paid", code: "ALREADY_PAID" });
      }
      if (err.code === "NOT_FOUND") return res.status(404).json({ error: "Order not found" });
      throw err;
    }
  }

  if (existing.status === "Paid") {
    return res
      .status(409)
      .json({ error: "Order is paid and cannot be moved to another status", code: "ALREADY_PAID" });
  }

  const applyStatus = db.transaction(() => {
    const current = db.prepare("SELECT status FROM orders WHERE id = ?").get(existing.id);
    if (!current || current.status === "Paid") return false;
    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, existing.id);
    return true;
  });

  if (!applyStatus()) {
    return res
      .status(409)
      .json({ error: "Order is paid and cannot be moved to another status", code: "ALREADY_PAID" });
  }

  cache.invalidate();
  res.json(loadOrder(req.params.id));
});

module.exports = router;
