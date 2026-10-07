const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { isPositiveInt, isOneOf } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth);

const VALID_STATUSES = ["Available", "Occupied", "Ordering", "Closed"];

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM tables ORDER BY id ASC").all());
});

router.post("/", (req, res) => {
  const { name, seats, status } = req.body || {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (seats !== undefined && !isPositiveInt(seats)) {
    return res.status(400).json({ error: "seats must be a positive whole number" });
  }
  try {
    const info = db
      .prepare("INSERT INTO tables (name, seats, status) VALUES (?, ?, ?)")
      .run(name.trim(), Number(seats) || 4, status && VALID_STATUSES.includes(status) ? status : "Available");
    const row = db.prepare("SELECT * FROM tables WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(409).json({ error: "A table with that name already exists" });
  }
});

router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM tables WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const { name, seats, status } = req.body || {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  if (seats !== undefined && !isPositiveInt(seats)) {
    return res.status(400).json({ error: "seats must be a positive whole number" });
  }
  if (status !== undefined && !isOneOf(status, VALID_STATUSES)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  db.prepare("UPDATE tables SET name = ?, seats = ?, status = ? WHERE id = ?").run(
    name !== undefined ? name.trim() : existing.name,
    seats != null ? Number(seats) : existing.seats,
    status ?? existing.status,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM tables WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM tables WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Table not found" });
  res.status(204).end();
});

module.exports = router;
