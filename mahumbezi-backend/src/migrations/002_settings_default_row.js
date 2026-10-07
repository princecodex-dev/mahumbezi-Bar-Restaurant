module.exports = {
  up(db) {
    const row = db.prepare("SELECT id FROM settings WHERE id = 1").get();
    if (!row) {
      db.prepare(
        `INSERT INTO settings (id, restaurant_name, address, phone, currency, vat_rate)
         VALUES (1, 'Mahumbezi Bar & Restaurant', 'KG 7 Ave, Kigali, Rwanda', '+250 788 000 111', 'RWF', 18)`
      ).run();
    }
  },
};
