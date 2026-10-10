const db = require("./db");
const cache = require("./reportCache");
const audit = require("./audit");
const ebm = require("./ebm");

/**
 * "Mark this order Paid" lives in one place because three different code
 * paths need it to behave identically:
 *
 *   1. PATCH /api/orders/:id/status with status "Paid" (the cashier's modal)
 *   2. GET  /api/payments/:id  once a Mobile Money charge finally settles
 *      (the customer approved on their handset after we'd already returned a
 *      202 to the cashier)
 *   3. any future webhook/callback from a gateway
 *
 * The status re-read happens inside the transaction, so two concurrent
 * callers cannot both observe "not paid yet" and both proceed.
 */

function loadOrder(id) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return null;
  order.items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(id);
  return order;
}

function alreadyPaid(orderId) {
  const err = new Error("Order is already paid");
  err.code = "ALREADY_PAID";
  err.orderId = orderId;
  return err;
}

const freeTableOnPaid = db.prepare(
  `UPDATE tables
      SET status = 'Available'
    WHERE status IN ('Occupied', 'Ordering')
      AND name = ?
      AND NOT EXISTS (
        SELECT 1 FROM orders o2
         WHERE o2.table_name = ? AND o2.status != 'Paid' AND o2.id != ?
      )`
);

const markPaid = db.prepare("UPDATE orders SET status = 'Paid', method = ? WHERE id = ?");

/**
 * Move an order to Paid and run every side effect that implies: free the
 * table (unless another open order is still on it), open an EBM row,
 * invalidate the reports cache, write the audit entry.
 *
 * Throws { code: "NOT_FOUND" } or { code: "ALREADY_PAID" } — callers map
 * those to 404/409. Returns the freshly loaded order.
 */
function markOrderPaid(orderId, method, req) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (order.status === "Paid") throw alreadyPaid(orderId);

  const apply = db.transaction(() => {
    const current = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId);
    if (!current) {
      const err = new Error("Order not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    if (current.status === "Paid") throw alreadyPaid(orderId);

    markPaid.run(method, orderId);
    freeTableOnPaid.run(order.table_name, order.table_name, orderId);
    ebm.recordUnfiscalised(orderId);
    return order;
  });

  apply();
  cache.invalidate();
  audit.log(req, "order.paid", {
    entity: "order",
    entityId: orderId,
    detail: `${order.table_name} · ${method} · ${order.total}`,
  });
  return loadOrder(orderId);
}

module.exports = { loadOrder, markOrderPaid, alreadyPaid };
