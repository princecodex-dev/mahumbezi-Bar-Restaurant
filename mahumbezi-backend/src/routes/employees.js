const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../lib/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  VALID_ROLES,
  VALID_USER_STATUSES,
  isOneOf,
  isEmail,
} = require("../lib/validate");

const router = express.Router();
router.use(requireAuth);

function sanitize(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return rest;
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY id DESC").all();
  res.json(rows.map(sanitize));
});

// Only Admins/Managers can create, edit, or remove staff accounts.
router.post("/", requireRole("Admin", "Manager"), (req, res) => {
  const { name, email, password, role, phone, shift, status } = req.body || {};
  if (typeof name !== "string" || !name.trim() || !isEmail(email) || !role) {
    return res.status(400).json({ error: "a non-empty name, a valid email and role are required" });
  }
  if (!isOneOf(role, VALID_ROLES)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
  }
  if (status !== undefined && status !== null && !isOneOf(status, VALID_USER_STATUSES)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_USER_STATUSES.join(", ")}` });
  }
  const tempPassword = password || "ChangeMe123!";
  if (tempPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  const passwordHash = bcrypt.hashSync(tempPassword, 10);
  try {
    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, phone, shift, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        email.trim(),
        passwordHash,
        role,
        phone || null,
        shift || null,
        status || "Active"
      );
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ ...sanitize(row), tempPassword: password ? undefined : tempPassword });
  } catch (err) {
    res.status(409).json({ error: "A user with that email already exists" });
  }
});

router.put("/:id", requireRole("Admin", "Manager"), (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Employee not found" });

  const { name, email, role, phone, shift, status, password } = req.body || {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  if (email !== undefined && !isEmail(email)) {
    return res.status(400).json({ error: "email must be a valid email address" });
  }
  if (role !== undefined && !isOneOf(role, VALID_ROLES)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
  }
  if (status !== undefined && status !== null && !isOneOf(status, VALID_USER_STATUSES)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_USER_STATUSES.join(", ")}` });
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  db.prepare(
    `UPDATE users SET name = ?, email = ?, role = ?, phone = ?, shift = ?, status = ? WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    email !== undefined ? email.trim() : existing.email,
    role ?? existing.role,
    phone !== undefined ? phone : existing.phone,
    shift !== undefined ? shift : existing.shift,
    status ?? existing.status,
    req.params.id
  );
  if (password) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      bcrypt.hashSync(password, 10),
      req.params.id
    );
  }
  res.json(sanitize(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", requireRole("Admin", "Manager"), (req, res) => {
  const info = db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Employee not found" });
  res.status(204).end();
});

module.exports = router;
