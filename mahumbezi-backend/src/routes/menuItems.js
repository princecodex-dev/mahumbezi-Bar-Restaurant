const express = require("express");
const db = require("../lib/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { VALID_MENU_CATEGORIES, isNonNegativeNumber, isOneOf } = require("../lib/validate");
const audit = require("../lib/audit");

const router = express.Router();
router.use(requireAuth);

function serialize(row) {
  return { ...row, available: !!row.available };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM menu_items ORDER BY id DESC").all();
  res.json(rows.map(serialize));
});

router.post("/", (req, res) => {
  const { name, category, price, emoji, available } = req.body || {};
  if (typeof name !== "string" || !name.trim() || typeof category !== "string" || !category.trim()) {
    return res.status(400).json({ error: "name and category are required" });
  }
  if (!isOneOf(category, VALID_MENU_CATEGORIES)) {
    return res.status(400).json({ error: `category must be one of: ${VALID_MENU_CATEGORIES.join(", ")}` });
  }
  if (!isNonNegativeNumber(price)) {
    return res.status(400).json({ error: "price must be a non-negative number" });
  }
  const info = db
    .prepare(
      "INSERT INTO menu_items (name, category, price, emoji, available) VALUES (?, ?, ?, ?, ?)"
    )
    .run(name.trim(), category.trim(), Number(price), emoji || null, available === false ? 0 : 1);
  const row = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(info.lastInsertRowid);
  audit.log(req, "menu_item.create", { entity: "menu_item", entityId: row.id, detail: row.name });
  res.status(201).json(serialize(row));
});

router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Menu item not found" });

  const { name, category, price, emoji, available } = req.body || {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  if (category !== undefined) {
    if (typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "category must be a non-empty string" });
    }
    if (!isOneOf(category, VALID_MENU_CATEGORIES)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_MENU_CATEGORIES.join(", ")}` });
    }
  }
  if (price !== undefined && !isNonNegativeNumber(price)) {
    return res.status(400).json({ error: "price must be a non-negative number" });
  }
  db.prepare(
    `UPDATE menu_items SET name = ?, category = ?, price = ?, emoji = ?, available = ? WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    category !== undefined ? category.trim() : existing.category,
    price != null ? Number(price) : existing.price,
    emoji !== undefined ? emoji : existing.emoji,
    available !== undefined ? (available ? 1 : 0) : existing.available,
    req.params.id
  );
  const row = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  audit.log(req, "menu_item.update", { entity: "menu_item", entityId: row.id, detail: row.name });
  res.json(serialize(row));
});

router.delete("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  const info = db.prepare("DELETE FROM menu_items WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Menu item not found" });
  audit.log(req, "menu_item.delete", { entity: "menu_item", entityId: req.params.id, detail: existing && existing.name });
  res.status(204).end();
});

// --- Recipe (inventory linkage) ---
// A menu item can list which inventory items — and how much of each — one
// order of it consumes. Selling it then deducts that automatically. Purely
// optional: a menu item with no rows here just doesn't touch inventory.

router.get("/:id/ingredients", (req, res) => {
  const rows = db
    .prepare(
      `SELECT mi.id, mi.inventory_item_id, mi.qty_per_order, i.name, i.unit
       FROM menu_item_ingredients mi
       JOIN inventory_items i ON i.id = mi.inventory_item_id
       WHERE mi.menu_item_id = ?`
    )
    .all(req.params.id);
  res.json(rows);
});

// Body: [{ inventoryItemId, qtyPerOrder }, ...] — replaces the full list.
router.put("/:id/ingredients", requireRole("Admin", "Manager"), (req, res) => {
  const menuItem = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(req.params.id);
  if (!menuItem) return res.status(404).json({ error: "Menu item not found" });

  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: "body must be an array" });
  for (const row of list) {
    if (!isNonNegativeNumber(row.qtyPerOrder) || Number(row.qtyPerOrder) <= 0) {
      return res.status(400).json({ error: "qtyPerOrder must be a positive number for every ingredient" });
    }
    const inv = db.prepare("SELECT id FROM inventory_items WHERE id = ?").get(row.inventoryItemId);
    if (!inv) return res.status(400).json({ error: `inventory item ${row.inventoryItemId} does not exist` });
  }

  const replace = db.transaction(() => {
    db.prepare("DELETE FROM menu_item_ingredients WHERE menu_item_id = ?").run(req.params.id);
    const insert = db.prepare(
      "INSERT INTO menu_item_ingredients (menu_item_id, inventory_item_id, qty_per_order) VALUES (?, ?, ?)"
    );
    for (const row of list) {
      insert.run(req.params.id, row.inventoryItemId, Number(row.qtyPerOrder));
    }
  });
  replace();
  audit.log(req, "menu_item.recipe_update", { entity: "menu_item", entityId: req.params.id, detail: `${list.length} ingredient(s)` });

  const rows = db
    .prepare(
      `SELECT mi.id, mi.inventory_item_id, mi.qty_per_order, i.name, i.unit
       FROM menu_item_ingredients mi
       JOIN inventory_items i ON i.id = mi.inventory_item_id
       WHERE mi.menu_item_id = ?`
    )
    .all(req.params.id);
  res.json(rows);
});

module.exports = router;
