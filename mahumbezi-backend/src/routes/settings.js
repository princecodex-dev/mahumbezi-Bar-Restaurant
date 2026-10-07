const express = require("express");
const db = require("../lib/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const cache = require("../lib/reportCache");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM settings WHERE id = 1").get());
});

router.put("/", requireRole("Admin", "Manager"), (req, res) => {
  const existing = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const { restaurantName, address, phone, currency, vatRate } = req.body || {};
  if (vatRate !== undefined && (!Number.isFinite(Number(vatRate)) || Number(vatRate) < 0 || Number(vatRate) > 100)) {
    return res.status(400).json({ error: "vatRate must be a number between 0 and 100" });
  }
  db.prepare(
    `UPDATE settings SET restaurant_name = ?, address = ?, phone = ?, currency = ?, vat_rate = ? WHERE id = 1`
  ).run(
    restaurantName ?? existing.restaurant_name,
    address ?? existing.address,
    phone ?? existing.phone,
    currency ?? existing.currency,
    vatRate != null ? Number(vatRate) : existing.vat_rate
  );
  cache.invalidate();
  res.json(db.prepare("SELECT * FROM settings WHERE id = 1").get());
});

module.exports = router;
