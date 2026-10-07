const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { VALID_STOCK_CATEGORIES, isOneOf, isEmail } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth);

function withItemsSupplied(row) {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM inventory_items WHERE supplier = ?")
    .get(row.name);
  return { ...row, itemsSupplied: count };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM suppliers ORDER BY id DESC").all();
  res.json(rows.map(withItemsSupplied));
});

router.post("/", (req, res) => {
  const { name, category, contact, phone, email, status } = req.body || {};
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof category !== "string" ||
    !category.trim() ||
    typeof phone !== "string" ||
    !phone.trim()
  ) {
    return res.status(400).json({ error: "name, category and phone are required" });
  }
  if (!isOneOf(category, VALID_STOCK_CATEGORIES)) {
    return res.status(400).json({ error: `category must be one of: ${VALID_STOCK_CATEGORIES.join(", ")}` });
  }
  if (email !== undefined && email !== null && !isEmail(email)) {
    return res.status(400).json({ error: "email must be a valid email address" });
  }
  const info = db
    .prepare(
      `INSERT INTO suppliers (name, category, contact, phone, email, status) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      name.trim(),
      category.trim(),
      contact || null,
      phone.trim(),
      email || null,
      status === "Inactive" ? "Inactive" : "Active"
    );
  res.status(201).json(withItemsSupplied(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(info.lastInsertRowid)));
});

router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Supplier not found" });
  const { name, category, contact, phone, email, status } = req.body || {};
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
  if (phone !== undefined && (typeof phone !== "string" || !phone.trim())) {
    return res.status(400).json({ error: "phone must be a non-empty string" });
  }
  if (email !== undefined && email !== null && !isEmail(email)) {
    return res.status(400).json({ error: "email must be a valid email address" });
  }
  if (status !== undefined && status !== "Active" && status !== "Inactive") {
    return res.status(400).json({ error: 'status must be "Active" or "Inactive"' });
  }
  db.prepare(
    `UPDATE suppliers SET name = ?, category = ?, contact = ?, phone = ?, email = ?, status = ? WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    category !== undefined ? category.trim() : existing.category,
    contact !== undefined ? contact : existing.contact,
    phone !== undefined ? phone.trim() : existing.phone,
    email !== undefined ? email : existing.email,
    status ?? existing.status,
    req.params.id
  );
  res.json(withItemsSupplied(db.prepare("SELECT * FROM suppliers WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM suppliers WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Supplier not found" });
  res.status(204).end();
});

module.exports = router;
