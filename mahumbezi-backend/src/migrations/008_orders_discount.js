function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

module.exports = {
  up(db) {
    if (!hasColumn(db, "orders", "discount_type")) {
      // 'percent' | 'fixed' | NULL (no discount)
      db.exec(`ALTER TABLE orders ADD COLUMN discount_type TEXT`);
    }
    if (!hasColumn(db, "orders", "discount_value")) {
      // the % (0-100) or fixed amount the discount_type refers to
      db.exec(`ALTER TABLE orders ADD COLUMN discount_value REAL NOT NULL DEFAULT 0`);
    }
    if (!hasColumn(db, "orders", "discount_amount")) {
      // resolved RWF amount actually taken off — computed server-side and
      // stored so historical orders/reports don't shift if VAT or the
      // discount schema changes later
      db.exec(`ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0`);
    }
  },
};
