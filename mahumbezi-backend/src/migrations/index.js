const fs = require("fs");
const path = require("path");

/**
 * Minimal, dependency-free migration runner for better-sqlite3.
 *
 * Each file in src/migrations/ (other than this one and index.js) exports
 * { up(db) }. Applied migrations are recorded by filename in a
 * schema_migrations table, so each one runs exactly once per database, ever
 * — regardless of what data happens to be in other tables at the time. This
 * replaces the earlier approach of inferring "is this a fresh database?"
 * from row counts, which was fragile (see the "Bar" table bug: inserting
 * data before checking a count elsewhere made the count lie).
 */
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+.*\.js$/.test(f) && f !== "index.js")
    .sort(); // numeric filename prefixes keep this in the right order

  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name)
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const migration = require(path.join(dir, file));
    if (typeof migration.up !== "function") {
      throw new Error(`Migration ${file} does not export an up(db) function`);
    }
    // Not wrapped in a transaction here: SQLite forbids toggling the
    // foreign_keys pragma inside one, and some migrations need to. Each
    // migration is responsible for its own transactional safety (most just
    // use idempotent CREATE TABLE IF NOT EXISTS / guarded ALTER TABLE, which
    // is safe to interrupt and re-run without wrapping).
    migration.up(db);
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
    console.log(`[migrate] applied ${file}`);
  }
}

module.exports = { runMigrations };
