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
