const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const audit = require("../lib/audit");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

const ACCESS_TTL_SECONDS = 60 * 60; // 1h
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30d

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many token refreshes. Please log in again." },
});

const insertRefreshToken = db.prepare(
  `INSERT INTO refresh_tokens (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+${REFRESH_TTL_SECONDS} seconds'))`
);
const getRefreshToken = db.prepare("SELECT * FROM refresh_tokens WHERE id = ?");
const revokeRefreshToken = db.prepare(
  "UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL"
);
const revokeAllForUser = db.prepare(
  "UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
);
const cleanupOldTokens = db.prepare(
  `DELETE FROM refresh_tokens
   WHERE user_id = ?
     AND (expires_at < datetime('now') OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days')))`
);

// Issues a fresh access token, and a fresh refresh token tracked in the
// refresh_tokens table (so it can be individually revoked later — "log out
// this device" — without waiting out its full 30-day JWT expiry).
function signTokens(user) {
  const jti = crypto.randomUUID();
  insertRefreshToken.run(jti, user.id);
  cleanupOldTokens.run(user.id);

  const accessToken = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL_SECONDS }
  );
  const refreshToken = jwt.sign({ id: user.id, type: "refresh", jti }, JWT_SECRET, {
    expiresIn: REFRESH_TTL_SECONDS,
  });
  return { accessToken, refreshToken };
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

router.post("/login", loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    audit.log({ user: null }, "auth.login_failed", { entity: "user", entityId: user.id, detail: email });
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (user.status !== "Active") {
    return res.status(403).json({ error: "This account is not active" });
  }

  const { accessToken, refreshToken } = signTokens(user);
  audit.log({ user: publicUser(user) }, "auth.login", { entity: "user", entityId: user.id });
  res.json({ token: accessToken, refreshToken, user: publicUser(user) });
});

// Exchange a valid, non-revoked refresh token for a fresh access token and a
// NEW refresh token (rotation) — the old refresh token is revoked in the
// same step. If someone replays an already-rotated (or logged-out, or
// force-revoked) refresh token, it won't be found active here and the
// request is rejected, which also flags reuse of a possibly-stolen token.
router.post("/refresh", refreshLimiter, (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
  if (decoded.type !== "refresh" || !decoded.id || !decoded.jti) {
    return res.status(401).json({ error: "Not a valid refresh token" });
  }

  const stored = getRefreshToken.get(decoded.jti);
  if (!stored || stored.revoked_at || new Date(stored.expires_at + "Z") < new Date()) {
    return res.status(401).json({ error: "This session has been signed out. Please log in again." });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(decoded.id);
  if (!user || user.status !== "Active") {
    return res.status(401).json({ error: "Account is no longer active" });
  }

  revokeRefreshToken.run(decoded.jti);
  const { accessToken, refreshToken: nextRefresh } = signTokens(user);
  res.json({ token: accessToken, refreshToken: nextRefresh, user: publicUser(user) });
});

// Sign out one device: revoke just the refresh token presented, without
// requiring a still-valid access token (the person may be logging out
// precisely because their access token already expired).
router.post("/logout", (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });
  try {
    const decoded = jwt.decode(refreshToken); // no verify — logging out an expired/tampered token is harmless
    if (decoded && decoded.jti) revokeRefreshToken.run(decoded.jti);
  } catch (err) {
    // ignore malformed tokens — logout is idempotent either way
  }
  res.json({ ok: true });
});

// List this user's active sessions ("devices"), so they can spot and revoke
// one they don't recognise.
router.get("/sessions", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, created_at, expires_at
       FROM refresh_tokens
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

// Revoke one of this user's own sessions by id ("log out this device").
router.delete("/sessions/:id", requireAuth, (req, res) => {
  const row = getRefreshToken.get(req.params.id);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: "Session not found" });
  }
  revokeRefreshToken.run(req.params.id);
  res.status(204).end();
});

// Let a signed-in user change their own password. Also revokes every other
// refresh token for the account, so a compromised session doesn't survive
// a password change.
router.put("/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(newPassword, 10),
    user.id
  );
  revokeAllForUser.run(user.id);
  audit.log(req, "auth.password_change", { entity: "user", entityId: user.id });
  res.json({ ok: true });
});

module.exports = { router, signTokens, publicUser };
