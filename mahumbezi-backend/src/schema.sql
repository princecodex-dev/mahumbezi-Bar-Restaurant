-- Mahumbezi Bar & Restaurant System — database schema (SQLite)

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Waiter',   -- Admin, Manager, Waiter, Chef, Bartender, Cashier
  phone         TEXT,
  shift         TEXT,                             -- Morning, Afternoon, Evening
  status        TEXT NOT NULL DEFAULT 'Active',    -- Active, On Leave, Inactive
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS menu_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,                       -- Food, Drinks, Bar
  price      INTEGER NOT NULL,
  emoji      TEXT,
  available  INTEGER NOT NULL DEFAULT 1,           -- 0/1 boolean
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  seats  INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'Available'         -- Available, Occupied, Ordering, Closed
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT,
  tier       TEXT NOT NULL DEFAULT 'Regular',       -- Regular, VIP
  visits     INTEGER NOT NULL DEFAULT 0,
  spent      INTEGER NOT NULL DEFAULT 0,
  last_visit TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,                          -- Food, Drinks, Bar, Supplies
  contact  TEXT,
  phone    TEXT NOT NULL,
  email    TEXT,
  status   TEXT NOT NULL DEFAULT 'Active'           -- Active, Inactive
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,                         -- Food, Drinks, Bar, Supplies
  qty        REAL NOT NULL DEFAULT 0,
  unit       TEXT NOT NULL DEFAULT 'pcs',
  reorder    REAL NOT NULL DEFAULT 0,
  supplier   TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Preparing',      -- Preparing, Served, Paid
  method     TEXT,                                   -- Cash, Mobile Money, Card
  subtotal   INTEGER NOT NULL,
  tax        INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,                        -- snapshot of name at order time
  price        INTEGER NOT NULL,                     -- snapshot of unit price at order time
  qty          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  restaurant_name TEXT NOT NULL DEFAULT 'Mahumbezi Bar & Restaurant',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  currency        TEXT NOT NULL DEFAULT 'RWF',
  vat_rate        REAL NOT NULL DEFAULT 18
);

-- Indexes for the hot read paths (reports/analytics, POS order history).
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit ON customers (last_visit) WHERE last_visit IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tables_status ON tables (status);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items (category);
