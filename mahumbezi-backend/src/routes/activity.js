const express = require("express");
const db = require("../lib/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("Admin", "Manager"));

// GET /api/activity?limit=50&entity=order&action=order.paid
router.get("/", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const clauses = [];
  const params = [];

  if (req.query.entity) {
    clauses.push("entity = ?");
    params.push(req.query.entity);
  }
  if (req.query.action) {
    clauses.push("action = ?");
    params.push(req.query.action);
  }
  if (req.query.userId) {
    clauses.push("user_id = ?");
    params.push(Number(req.query.userId));
  }

  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const rows = db
    .prepare(`SELECT * FROM activity_log ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit);
  res.json(rows);
});

module.exports = router;
