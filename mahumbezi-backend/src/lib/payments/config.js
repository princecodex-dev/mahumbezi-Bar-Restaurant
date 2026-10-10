const db = require("../db");

/**
 * Environment + formatting helpers shared by the ledger (index.js) and the
 * individual gateways. Split out so mtnMomo.js / airtel.js never have to
 * require index.js — which is what requires them — and the module graph
 * stays acyclic.
 */

function mode() {
  return (process.env.PAYMENT_PROVIDER_MODE || "mock").toLowerCase();
}

function currency() {
  const row = db.prepare("SELECT currency FROM settings WHERE id = 1").get();
  return (row && row.currency) || "RWF";
}

/**
 * Turn a human-typed Rwandan number ("0788123456", "+250 788 123 456",
 * "250788123456") into the form both gateways expect — digits only, with the
 * country code. Falls back to the raw digits if nothing matches.
 */
function normalizeMsisdn(phone) {
  const raw = String(phone || "").replace(/\D/g, "");
  if (!raw) return "";
  const country = String(process.env.PAYMENT_COUNTRY_CODE || "250").replace(/\D/g, "");
  if (raw.startsWith(country) && raw.length > country.length + 6) return raw;
  if (raw.startsWith("0")) return country + raw.slice(1);
  return raw;
}

function positiveInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

module.exports = { mode, currency, normalizeMsisdn, positiveInt };
