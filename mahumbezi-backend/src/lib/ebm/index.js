const db = require("../db");

/**
 * Rwanda's EBM (Electronic Billing Machine) system requires VAT-registered
 * businesses to report each sale to RRA (Rwanda Revenue Authority) and put
 * an EBM-issued invoice number + QR code on the receipt. This is a legal
 * compliance requirement, not a nice-to-have — check with an accountant
 * whether Mahumbezi needs it before this app is used to bill real guests.
 *
 * This module does NOT implement real EBM submission. It records every
 * order in `ebm_invoices` with status "not_submitted" so the data model is
 * ready, and the receipt PDF (src/routes/receipts.js) honestly prints
 * "Not fiscalised (EBM not configured)" rather than a fake invoice number.
 *
 * To go live with this for real:
 *   1. Register as a VAT taxpayer with RRA and get assigned to their EBM
 *      system (RRA's domestic tax portal: https://irembo.gov.rw / RRA
 *      offices handle this — it is not a self-serve API signup).
 *   2. RRA issues (or certifies) EBM software/hardware through approved
 *      vendors — you cannot self-certify a homegrown integration. Ask RRA
 *      or your accountant which certified EBM software/SDMS provider to use.
 *   3. That certified provider gives you real API/SDK access and the
 *      invoice-number + QR-code format their EBM software issues.
 *   4. Implement `submitInvoice()` below against that provider's API, store
 *      the returned invoice number + QR code in `ebm_invoices`, and update
 *      receipts.js to print them once `status = 'submitted'`.
 */

const EBM_ENABLED = (process.env.EBM_ENABLED || "false").toLowerCase() === "true";

const upsertNotSubmitted = db.prepare(
  `INSERT INTO ebm_invoices (order_id, status) VALUES (?, 'not_submitted')
   ON CONFLICT(order_id) DO NOTHING`
);

/**
 * Called when an order is marked Paid. Records a "not_submitted" row so
 * every paid order has a consistent EBM record, even though nothing is
 * actually sent to RRA yet.
 */
function recordUnfiscalised(orderId) {
  upsertNotSubmitted.run(orderId);
}

/**
 * Would submit the order to RRA's EBM system and store the returned
 * invoice number + QR code. Throws until a certified EBM provider is
 * actually wired in here — see the file comment above.
 */
async function submitInvoice(orderId) {
  if (!EBM_ENABLED) {
    throw new Error("EBM fiscalisation is not enabled (EBM_ENABLED=false) and is not implemented yet.");
  }
  throw new Error(
    "EBM_ENABLED=true but no EBM provider is wired in — see src/lib/ebm/README.md before enabling this."
  );
}

module.exports = { recordUnfiscalised, submitInvoice, EBM_ENABLED };
