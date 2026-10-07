#!/usr/bin/env node
// Backs up the live SQLite database to a timestamped copy using SQLite's
// own online backup API (safe to run while the server is up and writing —
// unlike `cp`, which can copy a database mid-write and produce a corrupt
// file). Old backups beyond BACKUP_RETENTION_DAYS are pruned automatically.
//
// Run manually:      node scripts/backup.js
// Run via system cron (recommended for production — survives app
// restarts/crashes independently of the Node process):
//   0 2 * * *  cd /path/to/mahumbezi-backend && node scripts/backup.js >> backup.log 2>&1
//
// Set BACKUP_DIR to point somewhere off this disk if possible (a mounted
// volume, a synced folder, etc.) — a backup that lives on the same disk as
// the database it's backing up doesn't protect you from a disk failure.

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DATABASE_PATH || "./data/mahumbezi.db";
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), "backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 14;

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function runBackup() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backup] no database found at ${DB_PATH} — nothing to back up`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const dest = path.join(BACKUP_DIR, `mahumbezi-${timestamp()}.db`);
  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }

  // better-sqlite3's backup() produces a WAL-mode file with its own -shm/-wal
  // sidecars. Fold those into the main file so each backup is a single,
  // self-contained file — safer if it's later copied off-site by itself.
  const destDb = new Database(dest);
  destDb.pragma("wal_checkpoint(TRUNCATE)");
  destDb.pragma("journal_mode = DELETE");
  destDb.close();

  const sizeKb = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`[backup] wrote ${dest} (${sizeKb} KB)`);

  pruneOldBackups();
}

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("mahumbezi-") && f.endsWith(".db"));
  let removed = 0;
  for (const f of files) {
    const full = path.join(BACKUP_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) {
      // Each backup is a WAL-mode SQLite file with its own -shm/-wal
      // sidecars; remove those too or they pile up as orphans forever.
      for (const suffix of ["", "-shm", "-wal"]) {
        fs.rmSync(full + suffix, { force: true });
      }
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[backup] pruned ${removed} backup(s) older than ${RETENTION_DAYS} days`);
  }
}

runBackup().catch((err) => {
  console.error("[backup] failed:", err.message);
  process.exitCode = 1;
});
