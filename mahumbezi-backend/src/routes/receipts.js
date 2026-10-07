const express = require("express");
const PDFDocument = require("pdfkit");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

function fmt(n, currency) {
  return `${currency} ${Number(n).toLocaleString()}`;
}

// GET /api/orders/:id/receipt — streams a PDF receipt.
router.get("/:id/receipt", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const ebm = db.prepare("SELECT * FROM ebm_invoices WHERE order_id = ?").get(order.id);
  const currency = (settings && settings.currency) || "RWF";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receipt-${order.id}.pdf"`);

  const doc = new PDFDocument({ size: [227, 500 + items.length * 18], margin: 16 });
  doc.pipe(res);

  // --- Header ---
  doc.fontSize(13).font("Helvetica-Bold").text(settings.restaurant_name, { align: "center" });
  doc.fontSize(8).font("Helvetica").text(settings.address || "", { align: "center" });
  if (settings.phone) doc.text(settings.phone, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(9).text("-".repeat(40), { align: "center" });

  doc.fontSize(9).font("Helvetica-Bold").text(`Order #${order.id}  ·  ${order.table_name}`);
  doc.font("Helvetica").text(`${order.created_at} UTC`);
  doc.text(`Status: ${order.status}${order.method ? "  ·  " + order.method : ""}`);
  doc.text("-".repeat(40));

  // --- Line items ---
  doc.moveDown(0.3);
  for (const it of items) {
    const lineTotal = it.price * it.qty;
    doc.font("Helvetica").fontSize(9).text(`${it.qty} x ${it.name} ${" ".repeat(2)}${fmt(lineTotal, currency)}`);
  }
  doc.text("-".repeat(40));

  // --- Totals ---
  doc.font("Helvetica").fontSize(9);
  doc.text(`Subtotal: ${fmt(order.subtotal, currency)}`);
  if (order.discount_amount) {
    const label = order.discount_type === "percent" ? `Discount (${order.discount_value}%)` : "Discount";
    doc.text(`${label}: -${fmt(order.discount_amount, currency)}`);
  }
  doc.text(`VAT: ${fmt(order.tax, currency)}`);
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text(`Total: ${fmt(order.total, currency)}`);

  // --- Fiscalisation status (Rwanda EBM) ---
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(7);
  if (ebm && ebm.status === "submitted") {
    doc.text(`EBM Invoice: ${ebm.invoice_number}`, { align: "center" });
  } else {
    doc.text("Not fiscalised (EBM not configured)", { align: "center" });
  }

  doc.moveDown(0.5);
  doc.fontSize(8).text("Thank you — Good Food, Great Drinks, Happy People", { align: "center" });

  doc.end();
});

module.exports = router;
