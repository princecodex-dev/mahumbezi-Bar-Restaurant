module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         TEXT PRIMARY KEY,   -- the token's jti claim
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    `);
  },
};
