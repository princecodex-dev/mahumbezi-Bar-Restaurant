const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { VALID_STOCK_CATEGORIES, isNonNegativeNumber, isOneOf } = require("../lib/validate");
const cache = require("../lib/reportCache");

const router = express.Router();
router.use(requireAuth);

function withStatus(row) {
  let status = "In Stock";
  if (row.qty <= 0) status = "Out of Stock";
  else if (row.qty <= row.reorder) status = "Low Stock";
  return { ...row, status };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM inventory_items ORDER BY id DESC").all();
  res.json(rows.map(withStatus));
});

router.post("/", (req, res) => {
  const { name, category, qty, unit, reorder, supplier } = req.body || {};
  if (typeof name !== "string" || !name.trim() || typeof category !== "string" || !category.trim()) {
    return res.status(400).json({ error: "name and category are required" });
  }
  if (!isOneOf(category, VALID_STOCK_CATEGORIES)) {
    return res.status(400).json({ error: `category must be one of: ${VALID_STOCK_CATEGORIES.join(", ")}` });
  }
  if (!isNonNegativeNumber(qty) || !isNonNegativeNumber(reorder ?? 0)) {
    return res.status(400).json({ error: "qty and reorder must be non-negative numbers" });
  }
  const info = db
    .prepare(
      `INSERT INTO inventory_items (name, category, qty, unit, reorder, supplier) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      name.trim(),
      category.trim(),
      Number(qty),
      unit || "pcs",
      Number(reorder ?? 0),
      supplier || null
    );
  cache.invalidate();
  const row = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(withStatus(row));
});

router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Stock item not found" });

  const { name, category, qty, unit, reorder, supplier } = req.body || {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  if (category !== undefined) {
    if (typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "category must be a non-empty string" });
    }
    if (!isOneOf(category, VALID_STOCK_CATEGORIES)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_STOCK_CATEGORIES.join(", ")}` });
    }
  }
  if (qty !== undefined && !isNonNegativeNumber(qty)) {
    return res.status(400).json({ error: "qty must be a non-negative number" });
  }
  if (reorder !== undefined && !isNonNegativeNumber(reorder)) {
    return res.status(400).json({ error: "reorder must be a non-negative number" });
  }
  db.prepare(
    `UPDATE inventory_items
     SET name = ?, category = ?, qty = ?, unit = ?, reorder = ?, supplier = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    category !== undefined ? category.trim() : existing.category,
    qty != null ? Number(qty) : existing.qty,
    unit ?? existing.unit,
    reorder != null ? Number(reorder) : existing.reorder,
    supplier !== undefined ? supplier : existing.supplier,
    req.params.id
  );
  cache.invalidate();
  res.json(withStatus(db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(req.params.id)));
});

router.post("/:id/restock", (req, res) => {
  const existing = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Stock item not found" });

  const amount = Number((req.body || {}).amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });

  db.prepare(
    `UPDATE inventory_items SET qty = qty + ?, updated_at = datetime('now') WHERE id = ?`
  ).run(amount, req.params.id);
  cache.invalidate();
  res.json(withStatus(db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM inventory_items WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Stock item not found" });
  cache.invalidate();
  res.status(204).end();
});

module.exports = router;
