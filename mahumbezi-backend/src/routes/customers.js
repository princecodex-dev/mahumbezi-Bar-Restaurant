const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { isNonNegativeNumber, isOneOf, isEmail } = require("../lib/validate");
const cache = require("../lib/reportCache");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM customers ORDER BY id DESC").all());
});

router.post("/", (req, res) => {
  const { name, phone, email, tier } = req.body || {};
  if (typeof name !== "string" || !name.trim() || typeof phone !== "string" || !phone.trim()) {
    return res.status(400).json({ error: "name and phone are required" });
  }
  if (email !== undefined && email !== null && !isEmail(email)) {
    return res.status(400).json({ error: "email must be a valid email address" });
  }
  const info = db
    .prepare("INSERT INTO customers (name, phone, email, tier) VALUES (?, ?, ?, ?)")
    .run(name.trim(), phone.trim(), email || null, tier === "VIP" ? "VIP" : "Regular");
  cache.invalidate();
  res.status(201).json(db.prepare("SELECT * FROM customers WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Customer not found" });
  const { name, phone, email, tier, visits, spent, lastVisit } = req.body || {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  if (phone !== undefined && (typeof phone !== "string" || !phone.trim())) {
    return res.status(400).json({ error: "phone must be a non-empty string" });
  }
  if (email !== undefined && email !== null && !isEmail(email)) {
    return res.status(400).json({ error: "email must be a valid email address" });
  }
  if (tier !== undefined && !isOneOf(tier, ["Regular", "VIP"])) {
    return res.status(400).json({ error: 'tier must be "Regular" or "VIP"' });
  }
  if (visits !== undefined && !isNonNegativeNumber(visits)) {
    return res.status(400).json({ error: "visits must be a non-negative number" });
  }
  if (spent !== undefined && !isNonNegativeNumber(spent)) {
    return res.status(400).json({ error: "spent must be a non-negative number" });
  }
  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, email = ?, tier = ?, visits = ?, spent = ?, last_visit = ? WHERE id = ?`
  ).run(
    name ?? existing.name,
    phone ?? existing.phone,
    email !== undefined ? email : existing.email,
    tier ?? existing.tier,
    visits != null ? Number(visits) : existing.visits,
    spent != null ? Number(spent) : existing.spent,
    lastVisit !== undefined ? lastVisit : existing.last_visit,
    req.params.id
  );
  cache.invalidate();
  res.json(db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Customer not found" });
  cache.invalidate();
  res.status(204).end();
});

module.exports = router;
