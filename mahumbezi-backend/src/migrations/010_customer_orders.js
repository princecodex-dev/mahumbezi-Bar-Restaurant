// Customer-facing ordering: richer menu data + customer order attribution.
// Orders gain a lifecycle (Received -> Accepted -> Preparing -> Ready ->
// Served -> Paid) so a guest watching a QR-code order can see it move;
// the existing staff statuses stay valid, so nothing breaks.
module.exports = {
  up(db) {
    function addColumnIfMissing(table, column, definition) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.some((c) => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }

    addColumnIfMissing("menu_items", "description", "TEXT");
    addColumnIfMissing("menu_items", "image_url", "TEXT");
    addColumnIfMissing("orders", "customer_name", "TEXT");
    addColumnIfMissing("orders", "phone", "TEXT");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders (phone);
    `);
  },
};
