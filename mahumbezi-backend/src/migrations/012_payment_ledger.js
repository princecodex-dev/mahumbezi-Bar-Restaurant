// payment_transactions grows into a real ledger: which method was taken, in
// what currency, from which phone (Mobile Money), by which staff member, and
// why it failed when it did.
//
// The unique partial index is the load-bearing part — it lets SQLite itself
// guarantee "at most one successful payment per order", so a double-clicked
// Confirm button or two concurrent requests can never record a payment twice,
// no matter what the application code does.
module.exports = {
  up(db) {
    const addColumn = (table, column, definition) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!columns.includes(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    };

    addColumn("payment_transactions", "method", "TEXT");           // 'Cash' | 'Mobile Money' | 'Card'
    addColumn("payment_transactions", "currency", "TEXT");          // snapshot of settings.currency at time of sale
    addColumn("payment_transactions", "customer_phone", "TEXT");    // MSISDN pushed for Mobile Money collections
    addColumn("payment_transactions", "error", "TEXT");             // why a transaction failed / timed out
    addColumn("payment_transactions", "updated_at", "TEXT");        // last status change
    addColumn("payment_transactions", "taken_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_payment_txn_order
        ON payment_transactions(order_id);

      CREATE INDEX IF NOT EXISTS idx_payment_txn_created
        ON payment_transactions(created_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_txn_succeeded_order
        ON payment_transactions(order_id) WHERE status = 'succeeded';
    `);
  },
};
