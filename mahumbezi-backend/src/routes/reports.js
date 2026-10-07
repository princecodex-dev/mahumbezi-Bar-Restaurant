const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const cache = require("../lib/reportCache");

const router = express.Router();
router.use(requireAuth);

// Stored timestamps are UTC (SQLite datetime('now')); convert a day boundary
// to the UTC string we compare against so "today" matches the server's local
// calendar day.
function dayBounds(current) {
  const start = new Date(current);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const fmt = (d) => d.toISOString().slice(0, 19).replace("T", " ");
  return { start: fmt(start), end: fmt(end) };
}

function toLocalDayKey(date) {
  const d = new Date(date.toISOString());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

router.get("/summary", (req, res) => {
  const cached = cache.get();
  if (cached) return res.json(cached);

  const paidOrders = db.prepare("SELECT * FROM orders WHERE status = 'Paid'").all();
  const totalRevenue = paidOrders.reduce((s, o) => s + o.total, 0);
  const txCount = paidOrders.length;
  const avgOrder = txCount ? Math.round(totalRevenue / txCount) : 0;

  const methodTotals = ["Cash", "Mobile Money", "Card"].map((method) => ({
    method,
    total: paidOrders.filter((o) => o.method === method).reduce((s, o) => s + o.total, 0),
  }));

  // "Today" figures, computed against the server's local calendar day.
  const { start: todayStart, end: todayEnd } = dayBounds(new Date());
  const inDay = (createdAt) => createdAt >= todayStart && createdAt < todayEnd;
  const todayPaid = paidOrders.filter((o) => inDay(o.created_at));
  const todayOrdersCount = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND created_at < ?")
    .get(todayStart, todayEnd).c;
  const todayCustomers = db
    .prepare(
      `SELECT COUNT(*) AS c FROM customers
       WHERE last_visit IS NOT NULL AND last_visit >= ? AND last_visit < ?`
    )
    .get(todayStart, todayEnd).c;

  // Sales per day for the last 7 days (including today), used for the chart.
  const salesByDay = [];
  for (let i = 6; i >= 0; i--) {
    const current = new Date();
    current.setDate(current.getDate() - i);
    const { start, end } = dayBounds(current);
    const total = paidOrders
      .filter((o) => o.created_at >= start && o.created_at < end)
      .reduce((s, o) => s + o.total, 0);
    salesByDay.push({
      date: toLocalDayKey(current),
      label: current.toLocaleDateString(undefined, { weekday: "short" }),
      value: total,
    });
  }

  const inventory = db.prepare("SELECT * FROM inventory_items").all();
  const lowStockItems = inventory.filter((i) => i.qty <= i.reorder);

  const tables = db.prepare("SELECT * FROM tables").all();
  const tableStatusCounts = ["Available", "Occupied", "Ordering", "Closed"].map((status) => ({
    status,
    count: tables.filter((t) => t.status === status).length,
  }));

  // Units sold by category, derived from paid order line items
  const categoryUnitsSold = db
    .prepare(
      `SELECT mi.category AS category, SUM(oi.qty) AS sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
       WHERE o.status = 'Paid'
       GROUP BY mi.category`
    )
    .all();

  // Top sellers by units sold (paid orders only)
  const topSellers = db
    .prepare(
      `SELECT mi.name AS name, mi.emoji AS emoji, mi.category AS category, SUM(oi.qty) AS sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
       WHERE o.status = 'Paid' AND mi.id IS NOT NULL
       GROUP BY mi.id
       ORDER BY sold DESC
       LIMIT 5`
    )
    .all();

  const payload = {
    totalRevenue,
    transactions: txCount,
    averageOrderValue: avgOrder,
    today: {
      sales: todayPaid.reduce((s, o) => s + o.total, 0),
      orders: todayOrdersCount,
      customers: todayCustomers,
    },
    topSellers,
    salesByDay,
    lowStockCount: lowStockItems.length,
    lowStockItems,
    methodTotals,
    tableStatusCounts,
    categoryUnitsSold,
  };

  cache.set(payload);
  res.json(payload);
});

module.exports = router;
