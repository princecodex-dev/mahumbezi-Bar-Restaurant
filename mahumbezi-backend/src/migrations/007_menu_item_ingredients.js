module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS menu_item_ingredients (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_item_id      INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        qty_per_order     REAL NOT NULL,  -- how much of that inventory item one order of this menu item uses
        UNIQUE(menu_item_id, inventory_item_id)
      );
    `);
  },
};
