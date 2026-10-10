// Google Sign-In (Google Identity Services) account support.
//
// Purely additive: existing password accounts are untouched. `password_hash`
// stays NOT NULL — accounts created through Google get an unguessable random
// hash, so a normal password login can never succeed for them. `google_id`
// holds Google's stable `sub` claim and is unique when present, so repeated
// Google logins resolve to the same user instead of creating duplicates.
module.exports = {
  up(db) {
    function addColumnIfMissing(table, column, definition) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.some((c) => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }

    addColumnIfMissing("users", "google_id", "TEXT");
    addColumnIfMissing("users", "avatar_url", "TEXT");
    addColumnIfMissing("users", "auth_provider", "TEXT NOT NULL DEFAULT 'password'");

    // SQLite can't add a UNIQUE constraint via ALTER TABLE, so enforce
    // one-Google-account-per-user with a partial unique index.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
        ON users (google_id) WHERE google_id IS NOT NULL;
    `);
  },
};
