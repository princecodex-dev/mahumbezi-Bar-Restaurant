module.exports = {
  up(db) {
    // Only backfills existing databases. A brand-new database gets "Bar"
    // from scripts/seed.js's own table list (run separately, after
    // migrations, only when the tables list is empty) — this migration
    // must not race that by inserting data itself on a fresh DB, or
    // seedTables()'s "is this fresh?" check would see a non-empty table
    // and skip seeding the real T1..T8 tables entirely.
    const totalTables = db.prepare("SELECT COUNT(*) AS c FROM tables").get().c;
    if (totalTables === 0) return;

    const exists = db.prepare("SELECT 1 FROM tables WHERE name = 'Bar'").get();
    if (!exists) {
      db.prepare("INSERT INTO tables (name, seats, status) VALUES ('Bar', 6, 'Available')").run();
    }
  },
};
