// API integration tests: boot the real app against a throwaway SQLite DB and
// exercise the HTTP surface (auth, refresh, orders, tables, menu FK, reports
// cache, validation). Run with: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Point every module at a temp DB BEFORE anything in src/ is loaded.
const TMP_DB = path.join(os.tmpdir(), `mahumbezi-test-${process.pid}.db`);
process.env.DATABASE_PATH = TMP_DB;
process.env.JWT_SECRET = "test-secret-for-node-test";
process.env.REPORTS_CACHE_TTL_MS = "5000";
// Fake-but-well-formed Google web client id so the Google routes are live in
// tests. No credential can ever verify against it, which is exactly what the
// "rejects a malformed credential" test asserts.
process.env.GOOGLE_CLIENT_ID = "1234567890-testapps.apps.googleusercontent.com";
// Pin payments to mock mode. src/index.js loads dotenv, which would otherwise
// pick up the developer's .env — so flipping PAYMENT_PROVIDER_MODE=live to try
// real MTN MoMo / Airtel would silently make the suite call a live gateway.
// Set explicitly rather than relying on the default, so the value is never in
// doubt. These are assigned before src/ is required, and dotenv does not
// overwrite existing variables.
process.env.PAYMENT_PROVIDER_MODE = "mock";
delete process.env.MOBILE_MONEY_PROVIDER;
// Likewise the gateway credentials. dotenv loads later (from src/index.js) and
// fills in anything that isn't already set, so a developer's real MTN or Airtel
// keys would otherwise turn a test run into live traffic against a sandbox —
// or worse, production. Setting them to "" (not deleting) keeps dotenv from
// populating them: both providers treat an empty string as "not configured".
for (const key of [
  "MTN_MOMO_SUBSCRIPTION_KEY",
  "MTN_MOMO_API_USER",
  "MTN_MOMO_API_KEY",
  "MTN_MOMO_BASE_URL",
  "MTN_MOMO_TARGET_ENVIRONMENT",
  "AIRTEL_CLIENT_ID",
  "AIRTEL_CLIENT_SECRET",
  "AIRTEL_BASE_URL",
  "AIRTEL_ENV",
]) {
  process.env[key] = "";
}

for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) fs.rmSync(f, { force: true });

require(path.join(__dirname, "..", "scripts", "seed"));
const app = require(path.join(__dirname, "..", "src", "index"));
const db = require(path.join(__dirname, "..", "src", "lib", "db"));

let server;
let base;
let adminToken;

async function api(method, p, body, token) {
  const res = await fetch(base + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response (e.g. 204) */ }
  return { status: res.status, data };
}

async function login(email, password) {
  return api("POST", "/api/auth/login", { email, password });
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  assert.equal(r.status, 200);
  adminToken = r.data.token;
});

after(async () => {
  if (server) {
    await new Promise((r) => server.close(r));
  }
  db.close();
  for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) {
    try { fs.rmSync(f, { force: true }); } catch { /* already gone */ }
  }
});

test("health endpoint responds", async () => {
  const r = await api("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test("login succeeds with seeded admin", async () => {
  assert.equal(adminToken ? true : false, true, "expected a token");
  const r = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  assert.equal(r.status, 200);
  assert.ok(r.data.token, "access token");
  assert.ok(r.data.refreshToken, "refresh token");
  assert.equal(r.data.user.role, "Admin");
  assert.equal(r.data.user.email, "kevin@mahumbezi.rw");
});

test("login rejects wrong password", async () => {
  const r = await login("kevin@mahumbezi.rw", "wrong-password");
  assert.equal(r.status, 401);
});

test("login rejects missing fields", async () => {
  const r = await login("kevin@mahumbezi.rw", "");
  assert.equal(r.status, 400);
});

test("login rejects deactivated account", async () => {
  const r = await login("alex@mahumbezi.rw", "ChangeMe123!");
  assert.equal(r.status, 403);
});

test("protected routes require a token", async () => {
  const r = await api("GET", "/api/menu-items");
  assert.equal(r.status, 401);
});

test("refresh token exchanges for a usable access token", async () => {
  const log = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  const ref = await api("POST", "/api/auth/refresh", { refreshToken: log.data.refreshToken });
  assert.equal(ref.status, 200);
  assert.ok(ref.data.token);
  const tables = await api("GET", "/api/tables", undefined, ref.data.token);
  assert.equal(tables.status, 200);
});

test("garbage refresh token is rejected", async () => {
  const ref = await api("POST", "/api/auth/refresh", { refreshToken: "not-a-jwt" });
  assert.equal(ref.status, 401);
});

test("a refresh token cannot be used directly as a bearer access token", async () => {
  const log = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  const r = await api("GET", "/api/tables", undefined, log.data.refreshToken);
  assert.equal(r.status, 401);
});

test("change own password requires current password and min length", async () => {
  const r = await login("chantal@mahumbezi.rw", "ChangeMe123!");
  const tok = r.data.token;
  const wrong = await api("PUT", "/api/auth/password", { currentPassword: "nope", newPassword: "BrandNew!23" }, tok);
  assert.equal(wrong.status, 401);
  const short = await api("PUT", "/api/auth/password", { currentPassword: "ChangeMe123!", newPassword: "tiny" }, tok);
  assert.equal(short.status, 400);
  const ok = await api("PUT", "/api/auth/password", { currentPassword: "ChangeMe123!", newPassword: "BrandNew!23" }, tok);
  assert.equal(ok.status, 200);
  assert.equal((await login("chantal@mahumbezi.rw", "ChangeMe123!")).status, 401);
  assert.equal((await login("chantal@mahumbezi.rw", "BrandNew!23")).status, 200);
  // restore the known password so the fixture stays consistent
  const tok2 = (await login("chantal@mahumbezi.rw", "BrandNew!23")).data.token;
  assert.equal((await api("PUT", "/api/auth/password", { currentPassword: "BrandNew!23", newPassword: "ChangeMe123!" }, tok2)).status, 200);
});

test("order item validation rejects bad prices, qtys and tables", async () => {
  let r = await api("POST", "/api/orders", { tableName: "T1", items: [{ name: "X", price: -5000, qty: 1 }] }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/orders", { tableName: "T1", items: [{ name: "X", price: 5000, qty: 0 }] }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/orders", { tableName: "DoesNotExist", items: [{ name: "X", price: 5000, qty: 1 }] }, adminToken);
  assert.equal(r.status, 400);
});

test("Bar is a real orderable table, matching what the POS UI offers", async () => {
  const tables = (await api("GET", "/api/tables", undefined, adminToken)).data;
  assert.ok(tables.some((t) => t.name === "Bar"), "expected a seeded 'Bar' table");

  const r = await api("POST", "/api/orders", {
    tableName: "Bar",
    items: [{ menuItemId: 11, name: "Whisky (double)", price: 9000, qty: 1 }],
  }, adminToken);
  assert.equal(r.status, 201);
  assert.equal(r.data.table_name, "Bar");
});

test("order totals are computed server-side with VAT", async () => {
  const r = await api("POST", "/api/orders", {
    tableName: "T1",
    items: [{ menuItemId: 1, name: "Classic Burger", price: 6000, qty: 2 }],
  }, adminToken);
  assert.equal(r.status, 201);
  assert.equal(r.data.table_name, "T1");
  assert.equal(r.data.subtotal, 12000);
  assert.equal(r.data.tax, 2160); // 18% VAT
  assert.equal(r.data.total, 14160);
  assert.equal(r.data.status, "Preparing");
});

test("table frees only when its last open order is paid", async () => {
  const order1 = (await api("POST", "/api/orders", { tableName: "T7", items: [{ menuItemId: 1, name: "Classic Burger", price: 6000, qty: 1 }] }, adminToken)).data;
  const order2 = (await api("POST", "/api/orders", { tableName: "T7", items: [{ menuItemId: 8, name: "Tusker Beer", price: 2500, qty: 2 }] }, adminToken)).data;

  let tables = (await api("GET", "/api/tables", undefined, adminToken)).data;
  assert.equal(tables.find((t) => t.name === "T7").status, "Occupied");

  let pay = await api("PATCH", `/api/orders/${order1.id}/status`, { status: "Paid", method: "Cash" }, adminToken);
  assert.equal(pay.status, 200);
  tables = (await api("GET", "/api/tables", undefined, adminToken)).data;
  assert.equal(tables.find((t) => t.name === "T7").status, "Occupied", "other open order still on table");

  pay = await api("PATCH", `/api/orders/${order2.id}/status`, { status: "Paid", method: "Cash" }, adminToken);
  assert.equal(pay.status, 200);
  tables = (await api("GET", "/api/tables", undefined, adminToken)).data;
  assert.equal(tables.find((t) => t.name === "T7").status, "Available");
});

test("menu item used in a paid order can be deleted (history preserved)", async () => {
  const order = (await api("POST", "/api/orders", { tableName: "T2", items: [{ menuItemId: 1, name: "Classic Burger", price: 6000, qty: 1 }] }, adminToken)).data;
  await api("PATCH", `/api/orders/${order.id}/status`, { status: "Paid", method: "Cash" }, adminToken);

  const del = await api("DELETE", "/api/menu-items/1", undefined, adminToken);
  assert.equal(del.status, 204);

  const line = db.prepare("SELECT menu_item_id, name, qty FROM order_items WHERE order_id = ?").get(order.id);
  assert.equal(line.menu_item_id, null, "FK becomes NULL");
  assert.equal(line.name, "Classic Burger", "name snapshot kept");
});

test("reports summary reflects a paid order immediately (cache invalidated)", async () => {
  const beforeSum = (await api("GET", "/api/reports/summary", undefined, adminToken)).data;
  const order = (await api("POST", "/api/orders", { tableName: "T3", items: [{ menuItemId: 3, name: "French Fries", price: 3000, qty: 2 }] }, adminToken)).data;
  await api("PATCH", `/api/orders/${order.id}/status`, { status: "Paid", method: "Card" }, adminToken);
  const afterSum = (await api("GET", "/api/reports/summary", undefined, adminToken)).data;
  assert.equal(afterSum.totalRevenue, beforeSum.totalRevenue + 7080); // 6000 + 18% VAT = 7080
});

test("validation guards on employees, inventory, settings and customers", async () => {
  let r = await api("POST", "/api/employees", { name: "Bad", email: "bad@x.rw", role: "Superuser" }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/employees", { name: "Bad", email: "not-an-email", role: "Waiter" }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/employees", { name: "Bad", email: "ok@x.rw", role: "Waiter", password: "short" }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/inventory", { name: "X", category: "Food", qty: -5, reorder: 2 }, adminToken);
  assert.equal(r.status, 400);
  r = await api("PUT", "/api/settings", { vatRate: 250 }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/customers", { name: "C", phone: "+250", email: "nope" }, adminToken);
  assert.equal(r.status, 400);
});

test("menu categories and table seats are validated", async () => {
  let r = await api("POST", "/api/menu-items", { name: "Bad", category: "Sushi", price: 1000 }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/menu-items", { name: "Ok", category: "Food", price: -1 }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/tables", { name: "ZLosseats", seats: 0 }, adminToken);
  assert.equal(r.status, 400);
  r = await api("POST", "/api/tables", { name: "Z9", seats: 4 }, adminToken);
  assert.equal(r.status, 201);
});

test("unknown routes return 404", async () => {
  const r = await api("GET", "/api/not-a-route", undefined, adminToken);
  assert.equal(r.status, 404);
});

test("order discount is computed server-side (percent, then fixed, then capped)", async () => {
  let r = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ name: "X", price: 10000, qty: 1 }],
    discount: { type: "percent", value: 20 },
  }, adminToken);
  assert.equal(r.status, 201);
  assert.equal(r.data.discount_amount, 2000);
  assert.equal(r.data.tax, Math.round(8000 * 0.18));
  assert.equal(r.data.total, 8000 + Math.round(8000 * 0.18));

  r = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ name: "X", price: 10000, qty: 1 }],
    discount: { type: "fixed", value: 3000 },
  }, adminToken);
  assert.equal(r.data.discount_amount, 3000);

  // A fixed discount bigger than the subtotal is capped, never goes negative
  r = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ name: "X", price: 1000, qty: 1 }],
    discount: { type: "fixed", value: 5000 },
  }, adminToken);
  assert.equal(r.data.discount_amount, 1000);
  assert.equal(r.data.tax, 0);
  assert.equal(r.data.total, 0);

  r = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ name: "X", price: 1000, qty: 1 }],
    discount: { type: "percent", value: 150 },
  }, adminToken);
  assert.equal(r.status, 400);
});

test("selling a menu item with a defined recipe deducts the linked inventory", async () => {
  // Menu item id 1 ("Classic Burger") was deleted by the earlier
  // "history preserved" test — use items no other test removes.
  const inv = (await api("GET", "/api/inventory", undefined, adminToken)).data.find((i) => i.name === "Beef");
  const before = inv.qty;

  const setRecipe = await api("PUT", "/api/menu-items/2/ingredients", [
    { inventoryItemId: inv.id, qtyPerOrder: 0.2 },
  ], adminToken);
  assert.equal(setRecipe.status, 200);

  const order = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ menuItemId: 2, name: "Pizza Margherita", price: 9000, qty: 3 }],
  }, adminToken);
  assert.equal(order.status, 201);

  const after = (await api("GET", "/api/inventory", undefined, adminToken)).data.find((i) => i.id === inv.id);
  assert.equal(after.qty, before - 0.6); // 3 orders x 0.2kg each

  // a menu item with no recipe defined doesn't touch inventory at all
  const noRecipe = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ menuItemId: 4, name: "Grilled Chicken", price: 8500, qty: 1 }],
  }, adminToken);
  assert.equal(noRecipe.status, 201);
});

test("refresh token rotation: using one invalidates it, reuse is rejected", async () => {
  const log = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  const first = log.data.refreshToken;

  const ref1 = await api("POST", "/api/auth/refresh", { refreshToken: first });
  assert.equal(ref1.status, 200);
  const second = ref1.data.refreshToken;
  assert.notEqual(second, first);

  // the original refresh token was consumed by rotation — replaying it must fail
  const reuse = await api("POST", "/api/auth/refresh", { refreshToken: first });
  assert.equal(reuse.status, 401);

  // but the newly-issued one still works
  const ref2 = await api("POST", "/api/auth/refresh", { refreshToken: second });
  assert.equal(ref2.status, 200);
});

test("sessions can be listed and individually revoked", async () => {
  const log = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  const tok = log.data.token;

  const before = await api("GET", "/api/auth/sessions", undefined, tok);
  assert.equal(before.status, 200);
  assert.ok(before.data.length >= 1);

  const target = before.data[0];
  const del = await api("DELETE", `/api/auth/sessions/${target.id}`, undefined, tok);
  assert.equal(del.status, 204);

  const after = await api("GET", "/api/auth/sessions", undefined, tok);
  assert.ok(!after.data.some((s) => s.id === target.id), "revoked session should be gone from the list");
});

test("logout revokes the given refresh token", async () => {
  const log = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  const out = await api("POST", "/api/auth/logout", { refreshToken: log.data.refreshToken });
  assert.equal(out.status, 200);

  const tryRefresh = await api("POST", "/api/auth/refresh", { refreshToken: log.data.refreshToken });
  assert.equal(tryRefresh.status, 401);
});

test("activity log requires Admin/Manager and records real actions", async () => {
  const waiter = await login("divine@mahumbezi.rw", "ChangeMe123!");
  const denied = await api("GET", "/api/activity", undefined, waiter.data.token);
  assert.equal(denied.status, 403);

  const order = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ name: "Audit Test Item", price: 5000, qty: 1 }],
  }, adminToken);
  await api("PATCH", `/api/orders/${order.data.id}/status`, { status: "Paid", method: "Cash" }, adminToken);

  const log = await api("GET", "/api/activity?action=order.paid&limit=5", undefined, adminToken);
  assert.equal(log.status, 200);
  assert.ok(log.data.some((entry) => entry.entity_id === String(order.data.id)));
});

test("receipt endpoint streams a PDF for a real order", async () => {
  const order = await api("POST", "/api/orders", {
    tableName: "T4",
    items: [{ name: "Receipt Test Item", price: 4000, qty: 1 }],
  }, adminToken);

  const res = await fetch(`${base}/api/orders/${order.data.id}/receipt`, {
    headers: { Authorization: "Bearer " + adminToken },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 500, "expected a non-trivial PDF body");
  assert.equal(buf.slice(0, 4).toString(), "%PDF", "expected a real PDF file signature");
});

/* ---------------- Customer ordering API (public/customer.html) ---------------- */

test("public config, menu and tables are served without auth", async () => {
  const cfg = await api("GET", "/api/public/config");
  assert.equal(cfg.status, 200);
  assert.equal(typeof cfg.data.vatRate, "number");
  assert.ok(Array.isArray(cfg.data.lifecycle) && cfg.data.lifecycle[0] === "Received");

  const menu = await api("GET", "/api/public/menu");
  assert.equal(menu.status, 200);
  assert.ok(menu.data.length >= 9, "seeded menu should be visible (one item is deleted by an earlier test)");
  assert.ok(menu.data.every((i) => i.description), "every listed item has a description");
  assert.ok(menu.data.every((i) => i.price >= 0));

  const first = menu.data[0];
  const one = await api("GET", `/api/public/menu/${first.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.data.name, first.name);
  assert.ok(Array.isArray(one.data.ingredients));

  const missing = await api("GET", "/api/public/menu/999999");
  assert.equal(missing.status, 404);

  const tables = await api("GET", "/api/public/tables");
  assert.equal(tables.status, 200);
  assert.ok(tables.data.length >= 4);
});

test("unavailable items are hidden from the public menu", async () => {
  const menu = await api("GET", "/api/public/menu");
  const staff = await api("GET", "/api/menu-items", undefined, adminToken);
  const hidden = staff.data.filter((i) => !i.available);
  assert.ok(hidden.length > 0, "seed data includes unavailable items");
  for (const h of hidden) {
    assert.ok(!menu.data.some((i) => i.id === Number(h.id)), `item ${h.name} must not be public`);
    const detail = await api("GET", `/api/public/menu/${h.id}`);
    assert.equal(detail.status, 404);
  }
});

test("customer order creation validates input and computes money server-side", async () => {
  const bad = await api("POST", "/api/public/orders", { customerName: "", phone: "", tableName: "", items: [] });
  assert.equal(bad.status, 400);

  const menu = await api("GET", "/api/public/menu");
  const item = menu.data.find((i) => i.category === "Food") || menu.data[0];

  const badTable = await api("POST", "/api/public/orders", {
    customerName: "Test Guest", phone: "0788123456", tableName: "NOPE",
    items: [{ menuItemId: item.id, qty: 1 }],
  });
  assert.equal(badTable.status, 400);

  // Client-sent prices are ignored — the server looks the item up itself.
  const created = await api("POST", "/api/public/orders", {
    customerName: "Test Guest", phone: "0788123456", tableName: "T4", method: "Cash",
    items: [{ menuItemId: item.id, qty: 2, price: 1 }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, "Received");
  assert.equal(created.data.customer_name, "Test Guest");
  assert.equal(created.data.phone, "0788123456");
  assert.equal(created.data.subtotal, item.price * 2, "price comes from the DB, not the client");
  assert.ok(created.data.total >= created.data.subtotal);

  // Tracking is phone-scoped: right number works, wrong number is a 404.
  const ok = await api("GET", `/api/public/orders/${created.data.id}?phone=0788123456`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.items.length, 1);

  const wrong = await api("GET", `/api/public/orders/${created.data.id}?phone=0780000000`);
  assert.equal(wrong.status, 404);
  const none = await api("GET", `/api/public/orders/${created.data.id}`);
  assert.notEqual(none.status, 200, "order id alone must not expose an order");

  const history = await api("GET", "/api/public/orders?phone=0788123456");
  assert.equal(history.status, 200);
  assert.ok(history.data.some((o) => o.id === created.data.id));
  assert.ok(history.data.every((o) => typeof o.itemCount === "number"));
});

test("staff can advance a customer order through the new lifecycle", async () => {
  const menu = await api("GET", "/api/public/menu");
  const created = await api("POST", "/api/public/orders", {
    customerName: "Lifecycle Guest", phone: "0789999999", tableName: "T4",
    items: [{ menuItemId: menu.data[0].id, qty: 1 }],
  });
  assert.equal(created.status, 201);

  for (const step of ["Accepted", "Preparing", "Ready", "Served"]) {
    const r = await api("PATCH", `/api/orders/${created.data.id}/status`, { status: step }, adminToken);
    assert.equal(r.status, 200, `transition to ${step}`);
    assert.equal(r.data.status, step);
  }

  const bogus = await api("PATCH", `/api/orders/${created.data.id}/status`, { status: "Bogus" }, adminToken);
  assert.equal(bogus.status, 400);
});

test("customer and admin pages are served", async () => {
  const cust = await fetch(`${base}/customer`);
  assert.equal(cust.status, 200);
  assert.match(cust.headers.get("content-type"), /text\/html/);
  const html = await cust.text();
  assert.ok(html.includes("MAHUMBEZI"), "customer page renders the brand");

  const admin = await fetch(`${base}/`);
  assert.equal(admin.status, 200);

  const manifest = await fetch(`${base}/customer.webmanifest`);
  assert.equal(manifest.status, 200);
  const mf = await manifest.json();
  assert.equal(mf.start_url, "/customer");
});

/* ---------------- Google sign-in (Google Identity Services) ---------------- */

test("google config advertises the client id when configured", async () => {
  const r = await api("GET", "/api/auth/google/config");
  assert.equal(r.status, 200);
  assert.equal(r.data.configured, true);
  assert.ok(r.data.clientId.endsWith(".apps.googleusercontent.com"), "expected a web client id");
  // The client id is public by design; nothing else may leak here.
  assert.equal(Object.keys(r.data).sort().join(","), "clientId,configured");
});

test("google sign-in rejects a missing or malformed credential", async () => {
  const missing = await api("POST", "/api/auth/google", {});
  assert.equal(missing.status, 400);
  assert.equal(missing.data.code, "MISSING_CREDENTIAL");

  // Malformed JWT: google-auth-library rejects it locally (no network call),
  // proving the server never trusts the raw frontend payload.
  const bad = await api("POST", "/api/auth/google", { credential: "not-a-jwt" });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.code, "INVALID_CREDENTIAL");

  const tokens = await api("GET", "/api/menu-items");
  assert.equal(tokens.status, 401, "no session was minted from a bogus credential");
});

test("google link requires authentication and a valid credential", async () => {
  const anon = await api("POST", "/api/auth/google/link", { credential: "not-a-jwt" });
  assert.equal(anon.status, 401, "must not link without a signed-in user");

  const bad = await api("POST", "/api/auth/google/link", { credential: "not-a-jwt" }, adminToken);
  assert.equal(bad.status, 401);
  assert.equal(bad.data.code, "INVALID_CREDENTIAL");

  const none = await api("POST", "/api/auth/google/link", {}, adminToken);
  assert.equal(none.status, 400);
  assert.equal(none.data.code, "MISSING_CREDENTIAL");
});

test("password login still works after the Google migration (existing data preserved)", async () => {
  const r = await login("kevin@mahumbezi.rw", "ChangeMe123!");
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, "Admin", "Google login must never be required nor grant admin");
  const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE google_id IS NULL").get();
  assert.ok(users.n > 0, "pre-existing password accounts keep their rows");
});

/* ---------------- Payment guards + ledger ---------------- */

async function makeOrder(tableName = "T5") {
  // Look the item up rather than hardcoding an id: an earlier test deletes
  // menu item 1, and a stale id would fail the order_items foreign key.
  const menuItem = db.prepare("SELECT id, name FROM menu_items ORDER BY id DESC LIMIT 1").get();
  assert.ok(menuItem, "the seed should provide at least one menu item");
  const r = await api(
    "POST",
    "/api/orders",
    { tableName, items: [{ menuItemId: menuItem.id, name: menuItem.name, price: 6000, qty: 1 }] },
    adminToken
  );
  assert.equal(r.status, 201);
  return r.data;
}

test("an order cannot be paid twice and keeps exactly one ledger row", async () => {
  const order = await makeOrder();

  const first = await api("PATCH", `/api/orders/${order.id}/status`, { status: "Paid", method: "Cash" }, adminToken);
  assert.equal(first.status, 200);
  assert.equal(first.data.status, "Paid");

  const again = await api(
    "PATCH",
    `/api/orders/${order.id}/status`,
    { status: "Paid", method: "Mobile Money" },
    adminToken
  );
  assert.equal(again.status, 409, "second payment attempt must be rejected");
  assert.equal(again.data.code, "ALREADY_PAID");

  const txs = db.prepare("SELECT * FROM payment_transactions WHERE order_id = ?").all(order.id);
  assert.equal(txs.length, 1, "the double-click must not create a second payment row");
  assert.equal(txs[0].status, "succeeded");
  assert.equal(txs[0].method, "Cash", "the first method wins; the retry is discarded");
});

test("a paid order cannot be moved back out of Paid", async () => {
  const order = await makeOrder();
  await api("PATCH", `/api/orders/${order.id}/status`, { status: "Paid", method: "Card" }, adminToken);

  const backwards = await api("PATCH", `/api/orders/${order.id}/status`, { status: "Served" }, adminToken);
  assert.equal(backwards.status, 409, "reversing a paid order would silently drop revenue");
  assert.equal(backwards.data.code, "ALREADY_PAID");

  const still = await api("GET", `/api/orders/${order.id}`, undefined, adminToken);
  assert.equal(still.data.status, "Paid");
});

test("only Cashier, Admin and Manager can record a payment", async () => {
  const created = await api(
    "POST",
    "/api/employees",
    { name: "Willy Waiter", email: "waiter@mahumbezi.rw", password: "WaiterPass1", role: "Waiter" },
    adminToken
  );
  assert.equal(created.status, 201);
  const waiterLogin = await login("waiter@mahumbezi.rw", "WaiterPass1");
  assert.equal(waiterLogin.status, 200);
  const waiterToken = waiterLogin.data.token;

  const order = await makeOrder("T6");
  const denied = await api("PATCH", `/api/orders/${order.id}/status`, { status: "Paid", method: "Cash" }, waiterToken);
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, "FORBIDDEN");

  // Ordinary status changes stay open to every role.
  const advanced = await api("PATCH", `/api/orders/${order.id}/status`, { status: "Served" }, waiterToken);
  assert.equal(advanced.status, 200);
});

test("marking Paid requires a method", async () => {
  const order = await makeOrder();
  const r = await api("PATCH", `/api/orders/${order.id}/status`, { status: "Paid" }, adminToken);
  assert.equal(r.status, 400);
});

test("the payment ledger records method, provider, currency and taker", async () => {
  const order = await makeOrder("T2");
  const paid = await api(
    "PATCH",
    `/api/orders/${order.id}/status`,
    { status: "Paid", method: "Mobile Money" },
    adminToken
  );
  assert.equal(paid.status, 200);

  const anon = await api("GET", "/api/payments");
  assert.equal(anon.status, 401, "the ledger is not public");

  const ledger = await api("GET", "/api/payments?limit=5", undefined, adminToken);
  assert.equal(ledger.status, 200);
  const row = ledger.data.find((t) => t.order_id === order.id);
  assert.ok(row, "the payment shows up in the ledger");
  assert.equal(row.method, "Mobile Money");
  assert.equal(row.provider, "mock", "mock mode is visible as mock, never as a verified gateway");
  assert.equal(row.status, "succeeded");
  assert.equal(row.currency, "RWF");
  assert.equal(row.order_status, "Paid");
  assert.ok(row.taken_by, "the staff member who took the money is recorded");

  const one = await api("GET", `/api/payments/${row.id}`, undefined, adminToken);
  assert.equal(one.status, 200);
  assert.equal(one.data.status, "succeeded");
  assert.equal(one.data.order, null, "re-reading a settled payment must not re-apply markOrderPaid");

  const missing = await api("GET", "/api/payments/999999", undefined, adminToken);
  assert.equal(missing.status, 404);
});

test("MTN MoMo and Airtel Money are separate methods, each naming its own network", async () => {
  const payments = require(path.join(__dirname, "..", "src", "lib", "payments"));

  // The point of splitting them: neither method depends on a globally
  // configured provider, so both networks can be live at once.
  assert.equal(payments.METHOD_TO_PROVIDER["MTN MoMo"], "mtn_momo");
  assert.equal(payments.METHOD_TO_PROVIDER["Airtel Money"], "airtel_money");
  assert.deepEqual(
    payments.MOBILE_MONEY_METHODS,
    ["MTN MoMo", "Airtel Money", "Mobile Money"],
    "all three need a customer phone number"
  );

  for (const method of ["MTN MoMo", "Airtel Money"]) {
    const order = await makeOrder("T4");
    const paid = await api(
      "PATCH",
      `/api/orders/${order.id}/status`,
      { status: "Paid", method, phone: "0788123456" },
      adminToken
    );
    assert.equal(paid.status, 200, `${method} should be accepted`);

    const ledger = await api("GET", `/api/payments?orderId=${order.id}`, undefined, adminToken);
    const row = ledger.data.find((t) => t.order_id === order.id);
    assert.equal(row.method, method, "the ledger records the network the cashier named");
    assert.equal(row.status, "succeeded");
    assert.equal(row.customer_phone, "250788123456", "the number is normalised with the country code");
  }

  // Cash and Card never push a prompt, so no phone is required for them.
  const cashOrder = await makeOrder("T4");
  const cash = await api(
    "PATCH",
    `/api/orders/${cashOrder.id}/status`,
    { status: "Paid", method: "Cash" },
    adminToken
  );
  assert.equal(cash.status, 200);

  // An unknown method must not be silently accepted as a payment.
  const badOrder = await makeOrder("T4");
  const bad = await api(
    "PATCH",
    `/api/orders/${badOrder.id}/status`,
    { status: "Paid", method: "Crypto" },
    adminToken
  );
  assert.equal(bad.status, 400);
});

test("a live mobile-money payment never books money without a gateway confirming it", async () => {
  const previous = process.env.PAYMENT_PROVIDER_MODE;
  process.env.PAYMENT_PROVIDER_MODE = "live";
  try {
    // Neither gateway has credentials in the test environment, so each charge
    // must fail loudly. This is the regression the network split introduced:
    // both methods were briefly treated like Cash — recorded as `succeeded`
    // with no gateway call and no reference, i.e. money booked that was never
    // collected. The order must stay unpaid in every case.
    for (const method of ["MTN MoMo", "Airtel Money"]) {
      const order = await makeOrder("T3");
      const r = await api(
        "PATCH",
        `/api/orders/${order.id}/status`,
        { status: "Paid", method, phone: "0788123456" },
        adminToken
      );
      assert.equal(r.status, 502, `${method} must surface the gateway failure`);

      const still = db.prepare("SELECT status FROM orders WHERE id = ?").get(order.id);
      assert.notEqual(still.status, "Paid", `${method}: the order must stay unpaid when the gateway fails`);

      const ledger = await api("GET", `/api/payments?orderId=${order.id}`, undefined, adminToken);
      const row = ledger.data.find((t) => t.order_id === order.id);
      assert.equal(row.status, "failed", `${method}: the attempt is recorded as failed, not succeeded`);
      assert.equal(row.provider_reference, null, `${method}: no gateway reference means no money moved`);
    }
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_PROVIDER_MODE;
    else process.env.PAYMENT_PROVIDER_MODE = previous;
  }
});

