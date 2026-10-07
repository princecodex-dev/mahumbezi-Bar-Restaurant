module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_name  TEXT,                 -- snapshot, survives the user being deleted
        action     TEXT NOT NULL,        -- e.g. "order.paid", "menu_item.delete"
        entity     TEXT,                 -- e.g. "order", "menu_item"
        entity_id  TEXT,
        detail     TEXT,                 -- short human-readable summary
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
    `);
  },
};
