// Backfill the ledger for orders that were already marked Paid before
// payment_transactions existed (everything seeded by scripts/seed.js before
// this migration, plus any real sales taken in mock mode while the table was
// write-only).
//
// Without this, a database that already has revenue would open the Transaction
// Ledger panel empty, and the invariant "every Paid order has exactly one
// succeeded payment row" would only hold for sales made after the upgrade.
//
// taken_by stays NULL: we genuinely don't know who took that money, and
// inventing an actor would be worse than admitting it.
module.exports = {
  up(db) {
    const settings = db.prepare("SELECT currency FROM settings WHERE id = 1").get();
    const currency = (settings && settings.currency) || "RWF";

    const PROVIDER_BY_METHOD = { Cash: "cash", Card: "card", "Mobile Money": "mock" };

    const missing = db
      .prepare(
        `SELECT o.id, o.method, o.total, o.created_at
           FROM orders o
          WHERE o.status = 'Paid'
            AND NOT EXISTS (
              SELECT 1 FROM payment_transactions p
               WHERE p.order_id = o.id AND p.status = 'succeeded'
            )`
      )
      .all();

    const insertPayment = db.prepare(
      `INSERT INTO payment_transactions
         (order_id, provider, amount, status, method, currency, created_at, updated_at)
       VALUES (?, ?, ?, 'succeeded', ?, ?, ?, ?)`
    );
    const insertEbm = db.prepare(
      `INSERT INTO ebm_invoices (order_id, status) VALUES (?, 'not_submitted')
       ON CONFLICT(order_id) DO NOTHING`
    );

    const backfill = db.transaction(() => {
      for (const order of missing) {
        const method = order.method || "Cash";
        insertPayment.run(
          order.id,
          PROVIDER_BY_METHOD[method] || "cash",
          order.total,
          method,
          currency,
          order.created_at,
          order.created_at
        );
        insertEbm.run(order.id);
      }
      return missing.length;
    });

    const n = backfill();
    if (n > 0) console.log(`[migrate] backfilled ${n} payment transaction(s) for already-paid orders`);
  },
};
