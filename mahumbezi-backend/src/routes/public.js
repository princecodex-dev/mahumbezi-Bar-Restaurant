// Public, no-auth customer ordering API — backs public/customer.html.
// Anything a guest with a QR code can touch lives here: menu browsing,
// table picking, placing an order, and tracking it afterwards. Staff-only
// data (inventory, reports, employees, settings editing) stays behind
// requireAuth in the other route files.
const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../lib/db");
const { isPositiveInt } = require("../lib/validate");
const cache = require("../lib/reportCache");
const audit = require("../lib/audit");

const router = express.Router();

// Order placement is intentionally stricter than the global 300/min API
// ceiling — a guest should never hit this, but a script firing orders
// should. Placing ~10 orders a minute from one IP is already beyond
// anything a real table does.
const placeOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many orders from this device. Please wait a moment." },
});

const VALID_PAYMENT_METHODS = ["Cash", "Mobile Money"];
const PHONE_RE = /^[0-9+\s()-]{6,20}$/;

// Customer lifecycle. Staff POS orders still start at "Preparing" and stay
// valid — this list only defines what the guest sees move on the timeline.
const STATUS_LIFECYCLE = ["Received", "Accepted", "Preparing", "Ready", "Served", "Paid"];

router.get("/config", (req, res) => {
  const s = db.prepare("SELECT restaurant_name, address, phone, currency, vat_rate FROM settings WHERE id = 1").get();
  res.json({
    restaurantName: s ? s.restaurant_name : "Mahumbezi Bar & Restaurant",
    address: s ? s.address : "",
    phone: s ? s.phone : "",
    currency: s ? s.currency : "RWF",
    vatRate: s ? s.vat_rate : 18,
    lifecycle: STATUS_LIFECYCLE,
  });
});

// Only orderable items — hidden/86'd ones (available = 0) are gone for guests.
router.get("/menu", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, category, price, emoji, description, image_url
       FROM menu_items
       WHERE available = 1
       ORDER BY category, id`
    )
    .all();
  res.json(rows);
});

// Single item for the product-detail screen, with its recipe's ingredient
// names when the kitchen has linked one (else an empty list).
router.get("/menu/:id", (req, res) => {
  const item = db
    .prepare(
      `SELECT id, name, category, price, emoji, description, image_url
       FROM menu_items WHERE id = ? AND available = 1`
    )
    .get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  const ingredients = db
    .prepare(
      `SELECT ii.name AS name
       FROM menu_item_ingredients mi
       JOIN inventory_items ii ON ii.id = mi.inventory_item_id
       WHERE mi.menu_item_id = ?`
    )
    .all(item.id);
  res.json({ ...item, ingredients: ingredients.map((r) => r.name) });
});

router.get("/tables", (req, res) => {
  const rows = db.prepare("SELECT id, name, seats, status FROM tables ORDER BY id").all();
  res.json(rows);
});

// Public order lookup is scoped by phone number: an order id alone is not
// enough to read a guest's name/phone/items back. Sequential ids would
// otherwise make the whole day's orders enumerable by anyone.
function requirePhoneMatch(order, phone) {
  if (!phone || typeof phone !== "string") return false;
  return (order.phone || "") === phone.trim();
}

function loadOrder(id) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return null;
  order.items = db.prepare("SELECT name, price, qty FROM order_items WHERE order_id = ?").all(id);
  return order;
}

// Body: {
//   customerName, phone, tableName,
//   items: [{ menuItemId, qty }],
//   method: "Cash" | "Mobile Money"   (optional)
// }
// Prices are always looked up server-side — never taken from the client —
// and money is computed exactly like the staff POS route does.
router.post("/orders", placeOrderLimiter, (req, res) => {
  const { customerName, phone, tableName, items, method } = req.body || {};

  if (typeof customerName !== "string" || !customerName.trim()) {
    return res.status(400).json({ error: "Your name is required" });
  }
  if (typeof phone !== "string" || !PHONE_RE.test(phone.trim())) {
    return res.status(400).json({ error: "A valid phone number is required" });
  }
  if (!tableName || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Select a table and add at least one item" });
  }
  if (method != null && !VALID_PAYMENT_METHODS.includes(method)) {
    return res.status(400).json({ error: "Invalid payment method" });
  }
  if (items.length > 30) {
    return res.status(400).json({ error: "Too many different items in one order" });
  }
  for (const it of items) {
    if (!isPositiveInt(it.menuItemId) || !isPositiveInt(it.qty)) {
      return res.status(400).json({ error: "Each item needs a valid id and quantity" });
    }
    if (Number(it.qty) > 100) {
      return res.status(400).json({ error: "Quantity per item is capped at 100" });
    }
  }

  const tableExists = db.prepare("SELECT 1 AS present FROM tables WHERE name = ?").get(tableName);
  if (!tableExists) {
    return res.status(400).json({ error: `Table "${tableName}" does not exist` });
  }

  // Resolve every line from the DB: availability, price, name snapshot.
  const resolved = [];
  for (const it of items) {
    const mi = db
      .prepare("SELECT id, name, price, available FROM menu_items WHERE id = ?")
      .get(Number(it.menuItemId));
    if (!mi) return res.status(400).json({ error: "An item in your cart no longer exists" });
    if (!mi.available) return res.status(400).json({ error: `"${mi.name}" is not available right now` });
    resolved.push({ menuItemId: mi.id, name: mi.name, price: mi.price, qty: Number(it.qty) });
  }

  const settings = db.prepare("SELECT vat_rate FROM settings WHERE id = 1").get();
  const vatRate = settings ? settings.vat_rate : 18;
  const subtotal = resolved.reduce((s, it) => s + it.price * it.qty, 0);
  const tax = Math.round(subtotal * (vatRate / 100));
  const total = subtotal + tax;

  const insertOrder = db.prepare(
    `INSERT INTO orders (table_name, status, method, subtotal, tax, total, customer_name, phone)
     VALUES (?, 'Received', ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES (?, ?, ?, ?, ?)`
  );
  const markTableOccupied = db.prepare(
    `UPDATE tables SET status = 'Occupied' WHERE name = ? AND status != 'Occupied'`
  );
  const deductInventory = db.prepare(
    `UPDATE inventory_items SET qty = qty - ?, updated_at = datetime('now') WHERE id = ?`
  );
  const ingredientRows = db.prepare(
    `SELECT menu_item_id, inventory_item_id, qty_per_order
     FROM menu_item_ingredients WHERE menu_item_id = ?`
  );

  const createOrder = db.transaction(() => {
    const info = insertOrder.run(
      tableName,
      method || null,
      subtotal,
      tax,
      total,
      customerName.trim(),
      phone.trim()
    );
    const orderId = info.lastInsertRowid;
    for (const it of resolved) {
      insertItem.run(orderId, it.menuItemId, it.name, it.price, it.qty);
      // Same best-effort recipe deduction as the staff POS: allowed to go
      // negative rather than blocking an order over a stock-count mismatch.
      for (const ing of ingredientRows.all(it.menuItemId)) {
        deductInventory.run(ing.qty_per_order * it.qty, ing.inventory_item_id);
      }
    }
    markTableOccupied.run(tableName);
    return orderId;
  });

  const orderId = createOrder();
  cache.invalidate();
  audit.log(req, "order.create", {
    entity: "order",
    entityId: orderId,
    detail: `${tableName} · ${total} · ${customerName.trim()} (customer)`,
  });
  res.status(201).json(loadOrder(orderId));
});

// Guest's own order history: everything placed with their phone number.
router.get("/orders", (req, res) => {
  const phone = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ error: "A valid phone number is required" });
  }
  const rows = db
    .prepare(
      `SELECT id, table_name, status, method, subtotal, tax, total, customer_name, created_at
       FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 50`
    )
    .all(phone);
  res.json(rows.map((o) => ({ ...o, itemCount: db.prepare("SELECT COALESCE(SUM(qty),0) AS n FROM order_items WHERE order_id = ?").get(o.id).n })));
});

// Single order for the tracking screen; phone must match what was used
// when ordering (returned on the order object itself).
router.get("/orders/:id", (req, res) => {
  if (!isPositiveInt(Number(req.params.id))) {
    return res.status(404).json({ error: "Order not found" });
  }
  const order = loadOrder(Number(req.params.id));
  if (!order || !requirePhoneMatch(order, req.query.phone)) {
    return res.status(404).json({ error: "Order not found" });
  }
  res.json(order);
});

module.exports = router;
