#!/usr/bin/env node
// Restores the database from a backup file created by scripts/backup.js.
// Moves the CURRENT database aside (doesn't delete it) before restoring, so
// a bad restore is itself recoverable.
//
// Usage: node scripts/restore.js data/backups/mahumbezi-20260921-020000.db

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DATABASE_PATH || "./data/mahumbezi.db";
const backupFile = process.argv[2];

if (!backupFile) {
  console.error("Usage: node scripts/restore.js <path-to-backup.db>");
  console.error("List available backups with: ls " + (process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), "backups")));
  process.exit(1);
}
if (!fs.existsSync(backupFile)) {
  console.error(`Backup file not found: ${backupFile}`);
  process.exit(1);
}

if (fs.existsSync(DB_PATH)) {
  const setAside = `${DB_PATH}.before-restore-${Date.now()}`;
  fs.copyFileSync(DB_PATH, setAside);
  console.log(`[restore] current database saved to ${setAside} (not deleted, in case this restore is wrong)`);
}

fs.copyFileSync(backupFile, DB_PATH);
for (const suffix of ["-shm", "-wal"]) {
  fs.rmSync(DB_PATH + suffix, { force: true });
}

console.log(`[restore] restored ${DB_PATH} from ${backupFile}`);
console.log("[restore] restart the server for it to pick up the restored database.");
