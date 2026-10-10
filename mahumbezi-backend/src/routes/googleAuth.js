const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../lib/db");
const audit = require("../lib/audit");
const { signTokens, publicUser } = require("./auth"); // reuse same token/session logic
const { isConfigured, verifyCredential } = require("../lib/google");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/auth/google/config — expose client id and whether configured so
// the browser can load Google Identity Services only when ready. No secrets.
router.get("/google/config", (_req, res) => {
  res.json({
    configured: isConfigured(),
    clientId: process.env.GOOGLE_CLIENT_ID || "",
  });
});

// POST /api/auth/google — sign in or sign up with a Google ID token
router.post("/google", async (req, res) => {
  try {
    const { credential, remember } = req.body || {};
    const verified = await verifyCredential(credential);

    const existing = db
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .get(verified.googleId);

    if (existing) {
      if (existing.status !== "Active") {
        return res.status(403).json({ error: "This account is not active" });
      }
      if (existing.email.toLowerCase() !== verified.email) {
        // Defensive: keep email in sync if Google changed it
        db.prepare("UPDATE users SET email = ? WHERE id = ?").run(
          verified.email,
          existing.id
        );
      }
      if (verified.picture && !existing.avatar_url) {
        db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(
          verified.picture,
          existing.id
        );
      }
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
      const { accessToken, refreshToken } = signTokens(user);
      audit.log(
        { user: publicUser(user) },
        "auth.google.login",
        { entity: "user", entityId: user.id }
      );
      return res.json({ token: accessToken, refreshToken, user: publicUser(user) });
    }

    // No google_id match. Check by email to avoid duplicate accounts.
    const byEmail = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(verified.email);
    if (byEmail) {
      // Account exists with same email but was created via password (or other).
      // Do NOT auto-link insecurely. Require a secure link step (e.g. password
      // confirmation). Return a 409 with a machine-readable code so the
      // frontend can trigger linking UI. Also log attempt without exposing tokens.
      audit.log(
        null,
        "auth.google.link_required",
        { entity: "user", entityId: byEmail.id, detail: verified.email }
      );
      return res.status(409).json({
        error:
          "An account with this email already exists. Please sign in with your password first to link Google.",
        code: "EMAIL_EXISTS",
        email: verified.email,
      });
    }

    // Create a new account via Google. Since password_hash is NOT NULL,
    // store an unguessable random hash so password login never works.
    const randomHash = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);
    const role = "Waiter"; // default for newly created Google users
    try {
      const info = db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, status, google_id, avatar_url, auth_provider)
           VALUES (?, ?, ?, ?, 'Active', ?, ?, 'google')`
        )
        .run(
          verified.name,
          verified.email,
          randomHash,
          role,
          verified.googleId,
          verified.picture
        );
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
      const { accessToken, refreshToken } = signTokens(user);
      audit.log(
        { user: publicUser(user) },
        "auth.google.signup",
        { entity: "user", entityId: user.id }
      );
      return res.status(201).json({ token: accessToken, refreshToken, user: publicUser(user) });
    } catch (err) {
      return res
        .status(409)
        .json({ error: "Could not create account from Google profile." });
    }
  } catch (err) {
    const status = err.status || 500;
    const message =
      status === 500 ? "Google sign-in failed. Please try again." : err.message;
    return res.status(status).json({ error: message, code: err.code });
  }
});

// POST /api/auth/google/link — link a Google account to an existing signed-in
// user (after password verification or as an authorized action). This allows
// linking when the email matches an existing account.
router.post("/google/link", requireAuth, async (req, res) => {
  try {
    const { credential } = req.body || {};
    const verified = await verifyCredential(credential);

    const googleUser = db
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .get(verified.googleId);
    if (googleUser && googleUser.id !== req.user.id) {
      return res
        .status(409)
        .json({ error: "This Google account is already linked to another user." });
    }
    if (googleUser) {
      return res.json({ ok: true });
    }

    const me = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!me) return res.status(404).json({ error: "User not found" });

    db.prepare(
      "UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), auth_provider = 'google' WHERE id = ?"
    ).run(verified.googleId, verified.picture, req.user.id);

    audit.log(req, "auth.google.link", { entity: "user", entityId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    const message = status === 500 ? "Could not link Google account." : err.message;
    return res.status(status).json({ error: message, code: err.code });
  }
});

module.exports = router;
