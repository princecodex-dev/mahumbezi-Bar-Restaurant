const VALID_ROLES = ["Admin", "Manager", "Waiter", "Chef", "Bartender", "Cashier"];
const VALID_USER_STATUSES = ["Active", "Inactive", "On Leave"];
const VALID_MENU_CATEGORIES = ["Food", "Drinks", "Bar"];
const VALID_STOCK_CATEGORIES = ["Food", "Drinks", "Bar", "Supplies"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1;
}

function isEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value);
}

function isOneOf(value, list) {
  return typeof value === "string" && list.includes(value);
}

module.exports = {
  VALID_ROLES,
  VALID_USER_STATUSES,
  VALID_MENU_CATEGORIES,
  VALID_STOCK_CATEGORIES,
  isNonNegativeNumber,
  isPositiveInt,
  isEmail,
  isOneOf,
};