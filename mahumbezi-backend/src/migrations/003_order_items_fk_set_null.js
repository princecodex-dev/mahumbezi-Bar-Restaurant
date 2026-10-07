module.exports = {
  up(db) {
    const fkInfo = db.prepare("PRAGMA foreign_key_list('order_items')").all();
    const fk = fkInfo.find((f) => f.from === "menu_item_id");
    if (fk && String(fk.on_delete).toUpperCase() === "SET NULL") return; // already correct

    db.pragma("foreign_keys = OFF");
    db.exec(`
      ALTER TABLE order_items RENAME TO order_items_old;
      CREATE TABLE order_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
        name         TEXT NOT NULL,
        price        INTEGER NOT NULL,
        qty          INTEGER NOT NULL
      );
      INSERT INTO order_items (id, order_id, menu_item_id, name, price, qty)
        SELECT id, order_id, menu_item_id, name, price, qty FROM order_items_old;
      DROP TABLE order_items_old;
    `);
    db.pragma("foreign_keys = ON");
  },
};
