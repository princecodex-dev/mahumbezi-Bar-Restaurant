# EBM (Rwanda fiscalisation)

## Is this required for Mahumbezi?

If Mahumbezi is VAT-registered, **probably yes** — Rwanda requires VAT
taxpayers to fiscalise sales through RRA's EBM system, with an EBM invoice
number and QR code on each receipt. This is a legal/tax question, not a
technical one — confirm with an accountant or RRA directly before relying
on this section either way.

## What this app does right now

Nothing is actually submitted to RRA. Every paid order gets a row in
`ebm_invoices` with `status = 'not_submitted'`, and the receipt PDF prints
**"Not fiscalised (EBM not configured)"** instead of a fake invoice number.
This is intentional — a fabricated invoice number would be worse than none.

`EBM_ENABLED` defaults to `false`. Setting it to `true` without also wiring
in a real, certified EBM provider just changes the error message you get
when `submitInvoice()` is called — it does not make fiscalisation work.

## What's actually needed to make this real

EBM is not a self-serve API you can integrate against directly:

1. Register as a VAT taxpayer and get enrolled in RRA's EBM system —
   this happens through RRA / Irembo, not through this codebase.
2. RRA works through certified EBM software/hardware vendors — you use
   one of their certified providers, you don't self-certify a custom
   integration.
3. That certified provider gives you the real API/SDK, and the exact
   invoice-number + QR-code format to store and print.
4. Implement `submitInvoice()` in `index.js` against that provider, and
   update `src/routes/receipts.js` to print the real invoice number and
   render the QR code once `ebm_invoices.status = 'submitted'`.

Budget real time for step 1 and 2 — they're administrative/legal processes
with RRA, not something that ships in a code change.
