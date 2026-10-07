const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { runMigrations } = require("../migrations");

const dbPath = process.env.DATABASE_PATH || "./data/mahumbezi.db";

// Make sure the folder for the db file exists (skip for in-memory ":memory:")
if (dbPath !== ":memory:") {
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Versioned, tracked migrations — see src/migrations/. Each one runs at
// most once per database, ever, regardless of what data happens to already
// be in other tables (replaces the old ad-hoc "check a row count to guess
// whether this is a fresh database" approach, which had a real bug: see
// migration 004's comment).
runMigrations(db);

module.exports = db;
