module.exports = {
  up(db) {
    db.exec(`
      -- One row per attempt to charge/verify a Mobile Money payment through
      -- a real provider (MTN MoMo, Airtel Money, ...). See
      -- src/lib/payments/README.md — this app ships a mock provider by
      -- default; wiring a real one needs that provider's own API
      -- credentials, which only the restaurant owner can obtain.
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        provider             TEXT NOT NULL,   -- 'mock', 'mtn_momo', 'airtel_money', 'cash', 'card'
        provider_reference  TEXT,             -- the provider's own transaction id, once known
        amount              INTEGER NOT NULL,
        status              TEXT NOT NULL,    -- 'pending' | 'succeeded' | 'failed'
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Rwanda's EBM (Electronic Billing Machine) system requires
      -- VAT-registered businesses to report each sale to RRA and print an
      -- EBM-issued invoice number + QR code on the receipt. This table is
      -- where that response would be stored once real EBM credentials are
      -- configured — see src/lib/ebm/README.md. Until then it stays empty
      -- and receipts are marked "not fiscalised".
      CREATE TABLE IF NOT EXISTS ebm_invoices (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        status        TEXT NOT NULL DEFAULT 'not_submitted', -- 'not_submitted' | 'submitted' | 'failed'
        invoice_number TEXT,
        qr_code_data  TEXT,
        submitted_at  TEXT,
        error         TEXT
      );
    `);
  },
};
