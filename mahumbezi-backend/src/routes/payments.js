const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const payments = require("../lib/payments");
const { markOrderPaid } = require("../lib/orderPaid");

const router = express.Router();
router.use(requireAuth);

const PROVIDER_TO_METHOD = { cash: "Cash", card: "Card" };

/**
 * GET /api/payments — the ledger, newest first.
 * Query: ?limit= (1-500, default 100), ?orderId=
 *
 * Readable by any signed-in role: the Sales & Payments screen already shows
 * paid order totals to everyone, and taking money (a write) is what's
 * restricted to Cashier/Admin/Manager.
 */
router.get("/", (req, res) => {
  res.json(
    payments.listTransactions({
      limit: req.query.limit,
      orderId: req.query.orderId,
    })
  );
});

/**
 * GET /api/payments/:id — one transaction, polled by the cashier's screen
 * while a live Mobile Money request sits waiting for the customer's PIN.
 *
 * Side effect: if the gateway now reports success and the order still isn't
 * Paid, this is where the order finally gets marked Paid (the cashier's
 * PATCH already returned 202 by then). markOrderPaid re-checks inside its
 * transaction, so a concurrent caller can't double-apply it.
 */
router.get("/:id", async (req, res) => {
  let tx = payments.getTransaction(req.params.id);
  if (!tx) return res.status(404).json({ error: "Payment not found" });

  try {
    tx = await payments.refreshTransaction(tx);
  } catch (err) {
    // Gateway unreachable. Don't 500 a polling loop — hand back the last
    // known state alongside why the refresh failed.
    return res.json({ ...tx, refreshError: err.message });
  }

  let order = null;
  if (tx.status === "succeeded") {
    const current = db.prepare("SELECT status FROM orders WHERE id = ?").get(tx.order_id);
    if (current && current.status !== "Paid") {
      const method = tx.method || PROVIDER_TO_METHOD[tx.provider] || "Mobile Money";
      try {
        order = markOrderPaid(tx.order_id, method, req);
      } catch (err) {
        if (err.code !== "ALREADY_PAID" && err.code !== "NOT_FOUND") throw err;
      }
    }
  }

  res.json({ ...tx, order });
});

module.exports = router;
