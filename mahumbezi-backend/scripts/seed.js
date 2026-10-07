require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const db = require("../src/lib/db");

function seedUsers() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "kevin@mahumbezi.rw";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";

  const employees = [
    { name: "Kevin Mugisha", email: adminEmail, password: adminPassword, role: "Admin", phone: "+250 788 001 122", shift: "Morning", status: "Active" },
    { name: "Chantal Uwimana", email: "chantal@mahumbezi.rw", password: "ChangeMe123!", role: "Manager", phone: "+250 788 002 233", shift: "Morning", status: "Active" },
    { name: "Eric Nshimiyimana", email: "eric@mahumbezi.rw", password: "ChangeMe123!", role: "Chef", phone: "+250 788 003 344", shift: "Afternoon", status: "Active" },
    { name: "Divine Iradukunda", email: "divine@mahumbezi.rw", password: "ChangeMe123!", role: "Waiter", phone: "+250 788 004 455", shift: "Evening", status: "Active" },
    { name: "Patrick Sano", email: "patrick@mahumbezi.rw", password: "ChangeMe123!", role: "Bartender", phone: "+250 788 005 566", shift: "Evening", status: "On Leave" },
    { name: "Josiane Mutoni", email: "josiane@mahumbezi.rw", password: "ChangeMe123!", role: "Cashier", phone: "+250 788 006 677", shift: "Morning", status: "Active" },
    { name: "Alex Bizimana", email: "alex@mahumbezi.rw", password: "ChangeMe123!", role: "Waiter", phone: "+250 788 007 788", shift: "Afternoon", status: "Inactive" },
  ];

  const insert = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, phone, shift, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const e of employees) {
    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(e.email);
    if (exists) continue;
    insert.run(e.name, e.email, bcrypt.hashSync(e.password, 10), e.role, e.phone, e.shift, e.status);
  }
  console.log(`Seeded ${employees.length} employee accounts (default password: ChangeMe123! unless overridden).`);
}

function seedMenuItems() {
  const items = [
    { name: "Classic Burger", category: "Food", price: 6000, emoji: "🍔", available: 1 },
    { name: "Pizza Margherita", category: "Food", price: 9000, emoji: "🍕", available: 1 },
    { name: "French Fries", category: "Food", price: 3000, emoji: "🍟", available: 1 },
    { name: "Grilled Chicken", category: "Food", price: 8500, emoji: "🍗", available: 1 },
    { name: "Beef Brochette", category: "Food", price: 4500, emoji: "🍢", available: 1 },
    { name: "Caesar Salad", category: "Food", price: 5000, emoji: "🥗", available: 0 },
    { name: "Mojito", category: "Drinks", price: 4000, emoji: "🍹", available: 1 },
    { name: "Tusker Beer", category: "Drinks", price: 2500, emoji: "🍺", available: 1 },
    { name: "Fresh Juice", category: "Drinks", price: 2000, emoji: "🧃", available: 1 },
    { name: "Coke", category: "Drinks", price: 1000, emoji: "🥤", available: 1 },
    { name: "Whisky (double)", category: "Bar", price: 9000, emoji: "🥃", available: 1 },
    { name: "Red Wine (glass)", category: "Bar", price: 5000, emoji: "🍷", available: 0 },
  ];
  const insert = db.prepare(
    `INSERT INTO menu_items (name, category, price, emoji, available) VALUES (?, ?, ?, ?, ?)`
  );
  const count = db.prepare("SELECT COUNT(*) AS c FROM menu_items").get().c;
  if (count === 0) {
    for (const i of items) insert.run(i.name, i.category, i.price, i.emoji, i.available);
    console.log(`Seeded ${items.length} menu items.`);
  }
}

function seedTables() {
  const tables = [
    { name: "T1", seats: 4, status: "Available" },
    { name: "T2", seats: 2, status: "Occupied" },
    { name: "T3", seats: 6, status: "Ordering" },
    { name: "T4", seats: 4, status: "Available" },
    { name: "T5", seats: 4, status: "Occupied" },
    { name: "T6", seats: 2, status: "Available" },
    { name: "T7", seats: 8, status: "Available" },
    { name: "T8", seats: 4, status: "Closed" },
    // The POS lets staff place bar-tab orders not tied to a dining table —
    // that only works if "Bar" is a real row here too.
    { name: "Bar", seats: 6, status: "Available" },
  ];
  const insert = db.prepare(`INSERT INTO tables (name, seats, status) VALUES (?, ?, ?)`);
  const count = db.prepare("SELECT COUNT(*) AS c FROM tables").get().c;
  if (count === 0) {
    for (const t of tables) insert.run(t.name, t.seats, t.status);
    console.log(`Seeded ${tables.length} tables.`);
  }
}

function seedInventory() {
  const items = [
    { name: "Beef", category: "Food", qty: 12, unit: "kg", reorder: 15, supplier: "Kigali Meats Ltd" },
    { name: "Chicken", category: "Food", qty: 20, unit: "kg", reorder: 10, supplier: "Kigali Meats Ltd" },
    { name: "Potatoes", category: "Food", qty: 8, unit: "kg", reorder: 20, supplier: "Fresh Farms Co." },
    { name: "Tomatoes", category: "Food", qty: 5, unit: "kg", reorder: 10, supplier: "Fresh Farms Co." },
    { name: "Cooking Oil", category: "Food", qty: 6, unit: "l", reorder: 10, supplier: "Fresh Farms Co." },
    { name: "Tusker Beer", category: "Drinks", qty: 36, unit: "bottles", reorder: 24, supplier: "Bralirwa Distributors" },
    { name: "Coke", category: "Drinks", qty: 10, unit: "bottles", reorder: 24, supplier: "Bralirwa Distributors" },
    { name: "Whisky (Johnnie Walker)", category: "Bar", qty: 3, unit: "bottles", reorder: 5, supplier: "Kigali Wines & Spirits" },
    { name: "Red Wine", category: "Bar", qty: 0, unit: "bottles", reorder: 6, supplier: "Kigali Wines & Spirits" },
    { name: "Napkins", category: "Supplies", qty: 40, unit: "packs", reorder: 15, supplier: "CleanCo Rwanda" },
  ];
  const insert = db.prepare(
    `INSERT INTO inventory_items (name, category, qty, unit, reorder, supplier) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const count = db.prepare("SELECT COUNT(*) AS c FROM inventory_items").get().c;
  if (count === 0) {
    for (const i of items) insert.run(i.name, i.category, i.qty, i.unit, i.reorder, i.supplier);
    console.log(`Seeded ${items.length} inventory items.`);
  }
}

function seedSuppliers() {
  const suppliers = [
    { name: "Kigali Meats Ltd", category: "Food", contact: "Patrick Habyarimana", phone: "+250 788 111 222", email: "sales@kigalimeats.rw", status: "Active" },
    { name: "Fresh Farms Co.", category: "Food", contact: "Solange Ingabire", phone: "+250 788 222 333", email: "orders@freshfarms.rw", status: "Active" },
    { name: "Bralirwa Distributors", category: "Drinks", contact: "Emmanuel Twagirayezu", phone: "+250 788 333 444", email: "distro@bralirwa.rw", status: "Active" },
    { name: "Kigali Wines & Spirits", category: "Bar", contact: "Yvonne Mutesi", phone: "+250 788 444 555", email: "info@kigaliwines.rw", status: "Active" },
    { name: "CleanCo Rwanda", category: "Supplies", contact: "Olivier Ndayishimiye", phone: "+250 788 555 666", email: "hello@cleanco.rw", status: "Inactive" },
  ];
  const insert = db.prepare(
    `INSERT INTO suppliers (name, category, contact, phone, email, status) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const count = db.prepare("SELECT COUNT(*) AS c FROM suppliers").get().c;
  if (count === 0) {
    for (const s of suppliers) insert.run(s.name, s.category, s.contact, s.phone, s.email, s.status);
    console.log(`Seeded ${suppliers.length} suppliers.`);
  }
}

function seedCustomers() {
  const customers = [
    { name: "Eric Niyonsaba", phone: "+250 788 123 456", email: "eric.n@example.com", tier: "VIP", visits: 24, spent: 612000 },
    { name: "Aline Umutoni", phone: "+250 788 234 567", email: "aline.u@example.com", tier: "Regular", visits: 15, spent: 348000 },
    { name: "Jean Bosco Habimana", phone: "+250 788 345 678", email: "jb.habimana@example.com", tier: "VIP", visits: 31, spent: 845000 },
    { name: "Grace Mukamana", phone: "+250 788 456 789", email: "grace.m@example.com", tier: "Regular", visits: 6, spent: 112000 },
    { name: "Kevin Ishimwe", phone: "+250 788 567 890", email: "kevin.i@example.com", tier: "Regular", visits: 9, spent: 189000 },
    { name: "Diane Uwase", phone: "+250 788 678 901", email: "diane.u@example.com", tier: "VIP", visits: 18, spent: 456000 },
  ];
  const insert = db.prepare(
    `INSERT INTO customers (name, phone, email, tier, visits, spent) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const count = db.prepare("SELECT COUNT(*) AS c FROM customers").get().c;
  if (count === 0) {
    for (const c of customers) insert.run(c.name, c.phone, c.email, c.tier, c.visits, c.spent);
    console.log(`Seeded ${customers.length} customers.`);
  }
}

function seedOrders() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM orders").get().c;
  if (count > 0) return;
  const tableCount = db.prepare("SELECT COUNT(*) AS c FROM tables").get().c;
  if (tableCount === 0) return;

  const { vat_rate } = db.prepare("SELECT vat_rate FROM settings WHERE id = 1").get();
  const menuById = {};
  for (const m of db.prepare("SELECT * FROM menu_items").all()) menuById[m.name] = m;

  const named = (n) => {
    const m = menuById[n];
    if (!m) throw new Error(`Seed order references unknown menu item "${n}"`);
    return m;
  };

  // [table, offset, status, method, [[name, qty], ...]]
  const specs = [
    ["T1", "-6 days", "Paid", "Cash", [["Classic Burger", 2], ["Tusker Beer", 2]]],
    ["T3", "-6 days", "Paid", "Mobile Money", [["Pizza Margherita", 1], ["Fresh Juice", 2]]],
    ["T2", "-5 days", "Paid", "Card", [["Grilled Chicken", 1], ["Red Wine (glass)", 2]]],
    ["T5", "-5 days", "Paid", "Cash", [["French Fries", 2], ["Coke", 3]]],
    ["T4", "-4 days", "Paid", "Mobile Money", [["Classic Burger", 3], ["Fresh Juice", 3]]],
    ["T1", "-4 days", "Paid", "Cash", [["Beef Brochette", 2], ["Mojito", 2]]],
    ["T6", "-3 days", "Paid", "Card", [["Whisky (double)", 2], ["Coke", 1]]],
    ["T2", "-3 days", "Paid", "Cash", [["Pizza Margherita", 2], ["Tusker Beer", 4]]],
    ["T7", "-2 days", "Paid", "Mobile Money", [["Grilled Chicken", 2], ["French Fries", 3]]],
    ["T3", "-2 days", "Paid", "Cash", [["Classic Burger", 2], ["Mojito", 3]]],
    ["T5", "-1 day", "Paid", "Card", [["Whisky (double)", 1], ["Tusker Beer", 2]]],
    ["T8", "-1 day", "Paid", "Cash", [["Caesar Salad", 2], ["Fresh Juice", 2]]],
    ["T1", "0 days", "Preparing", null, [["Classic Burger", 2], ["Coke", 2]]],
    ["T2", "0 days", "Served", null, [["Mojito", 2], ["Tusker Beer", 3]]],
    ["T4", "0 days", "Paid", "Cash", [["Pizza Margherita", 1], ["Fresh Juice", 2]]],
  ];

  const insertOrder = db.prepare(
    `INSERT INTO orders (table_name, status, method, subtotal, tax, total, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES (?, ?, ?, ?, ?)`
  );

  const createOrder = db.transaction(() => {
    for (const [table, offset, status, method, items] of specs) {
      const subtotal = items.reduce((s, [name, qty]) => s + named(name).price * qty, 0);
      const tax = Math.round(subtotal * (vat_rate / 100));
      const total = subtotal + tax;
      const info = insertOrder.run(table, status, method, subtotal, tax, total, offset);
      for (const [name, qty] of items) {
        const m = named(name);
        insertItem.run(info.lastInsertRowid, m.id, m.name, m.price, qty);
      }
    }
  });
  createOrder();
  console.log(`Seeded ${specs.length} demo orders across the last week.`);

  // Keep table status consistent with reality: any table that now has an
  // open (non-Paid) order shouldn't still show as "Available".
  const sync = db.prepare(
    `UPDATE tables SET status = 'Occupied'
     WHERE status = 'Available'
       AND name IN (SELECT DISTINCT table_name FROM orders WHERE status != 'Paid')`
  );
  sync.run();
}

seedUsers();
seedMenuItems();
seedTables();
seedInventory();
seedSuppliers();
seedCustomers();
seedOrders();

console.log("Seed complete.");
