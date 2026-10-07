# Mahumbezi Bar & Restaurant — Backend + Connected Frontend

A self-contained Node.js API (Express + SQLite) that powers the Mahumbezi
dashboard, plus the same dashboard UI wired to call it for real. Deploy this
one project and you get both the website and the database behind it.

## What's inside

```
mahumbezi-backend/
├── src/
│   ├── index.js          # Express app entry point
│   ├── schema.sql         # Database schema (plain SQL, no ORM)
│   ├── lib/db.js          # SQLite connection (better-sqlite3)
│   ├── middleware/auth.js # JWT auth + role checks
│   └── routes/            # One file per resource (orders, tables, ...)
├── scripts/seed.js        # Populates demo data + staff logins
├── public/index.html      # The connected React dashboard (served as-is)
├── .env.example           # Copy to .env and fill in
└── package.json
```

No ORM, no build step for the backend. The frontend is a single static HTML
file (React + Babel loaded from a CDN, no bundler) that the API server serves
directly, so **one deployed process is the whole app**.

## 1. Local setup

```bash
npm install --ignore-scripts   # see note below on why --ignore-scripts
cp .env.example .env            # edit JWT_SECRET at minimum
npm run seed                     # creates the SQLite file + demo data
npm start                        # http://localhost:4000
```

**Why `--ignore-scripts`:** the only dependency with native code is
`better-sqlite3`, and it ships working prebuilt binaries for Linux/macOS/
Windows — no compilation needed. But it also ships a `binding.gyp` (in case
someone wants to force a source build on an unsupported platform), and npm's
default heuristic is to auto-run `node-gyp rebuild` for any package with a
`binding.gyp`, even when a prebuild is already bundled. That rebuild tries to
download Node's headers from `nodejs.org`, which fails in locked-down network
environments (CI runners, sandboxes, some corporate networks) with no real
upside — the prebuild it would have used anyway already works. If you're on
a normal, unrestricted network, a plain `npm install` works fine too; use
`--ignore-scripts` if you hit a `node-gyp` / `403` / header-download error.

Run the integration test suite (boots the app against a throwaway SQLite DB in
`os.tmpdir()`, seeds it, and exercises the full HTTP surface):

```bash
npm test                    # node --test, 26 checks
```

Open `http://localhost:4000` in a browser — you should see the login screen.

### Default login (created by the seed script)

| Email | Password | Role |
|---|---|---|
| kevin@mahumbezi.rw (or `SEED_ADMIN_EMAIL`) | `ChangeMe123!` (or `SEED_ADMIN_PASSWORD`) | Admin |

Six more demo staff accounts are seeded too (see `scripts/seed.js`), all with
password `ChangeMe123!`. **Change these before putting the app in front of
real users** — either edit `.env` before the first `npm run seed`, or update
passwords from the Employees / Users page once logged in as Admin.

## 2. Environment variables

See `.env.example` for the full list. The two you must set for any real
deployment:

- `JWT_SECRET` — long random string (`openssl rand -hex 32`). Anyone with
  this value can mint valid login tokens, so keep it out of source control.
- `DATABASE_PATH` — where the SQLite file lives. Defaults to
  `./data/mahumbezi.db`.

`CORS_ORIGIN` only matters if you host the frontend somewhere *other* than
this server (see section 5). If you're using the bundled `public/index.html`
as-is, you can ignore it.

## 3. Deploying on a VPS (recommended — simplest for SQLite)

SQLite is a single file on disk, so a VPS with a persistent filesystem is the
easiest target: nothing else to provision.

```bash
# On the server
git clone <your-repo> mahumbezi && cd mahumbezi
npm install --omit=dev --ignore-scripts   # see "why --ignore-scripts" in section 1
cp .env.example .env && nano .env      # set JWT_SECRET, etc.
npm run seed                            # first run only
npm start
```

Keep it running with a process manager, e.g. **pm2**:

```bash
npm install -g pm2
pm2 start src/index.js --name mahumbezi
pm2 save
pm2 startup   # follow the printed instructions to survive reboots
```

Put a reverse proxy in front for HTTPS (nginx + certbot is the usual combo):

```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then `certbot --nginx -d your-domain.com` for a free TLS certificate.

**Back up `data/mahumbezi.db` regularly** (it's the entire database) — e.g. a
nightly `cp` to another disk or object storage.

## 4. Deploying on Render / Railway

Both platforms run this the same way: **Build command**
`npm install --ignore-scripts` (see the note in section 1 — avoids a
`node-gyp`/network failure on `better-sqlite3`, which doesn't need it
anyway), **Start command** `npm start`, and set the environment variables
from `.env.example` in their dashboard.

⚠️ **Persistence matters here.** Render and Railway's default web service
filesystem is *ephemeral* — it's wiped on every redeploy. Since this app
stores data in a SQLite file on disk, that means **your data disappears on
every deploy** unless you attach a persistent volume/disk:

- **Render**: add a "Disk" to the service, mount it at e.g. `/data`, and set
  `DATABASE_PATH=/data/mahumbezi.db`.
- **Railway**: add a "Volume", mount it at e.g. `/data`, same env var change.

If you'd rather not deal with disks at all, the cleaner long-term fix is
swapping SQLite for a managed Postgres instance (both platforms offer one).
That's a real migration (different driver, `src/lib/db.js`, and rewriting the
SQL in each route file since column placeholders and a few functions differ),
not a config change — happy to do that conversion if you decide to go that
route.

## 5. Hosting the frontend separately

By default `public/index.html` is served by this same Express app and calls
the API at the same origin (`/api/...`) — nothing to configure.

If you ever want to host the HTML file somewhere else (a CDN, a different
static host) while this server stays purely an API:

1. Set `window.API_BASE_URL = "https://your-api-domain.com/api";` in a
   `<script>` tag before the app's own script in `index.html`.
2. Set `CORS_ORIGIN` in the API's `.env` to that frontend's origin (comma-
   separate multiple origins if needed).

## 6. API overview

All routes except `/api/auth/login` and `/api/auth/refresh` require
`Authorization: Bearer <token>`.

| Resource | Routes |
|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/refresh`, `PUT /api/auth/password` |
| Menu items | `GET/POST /api/menu-items`, `PUT/DELETE /api/menu-items/:id` |
| Tables | `GET/POST /api/tables`, `PUT/DELETE /api/tables/:id` |
| Orders | `GET/POST /api/orders`, `PATCH /api/orders/:id/status` |
| Inventory | `GET/POST /api/inventory`, `PUT/DELETE /api/inventory/:id`, `POST /api/inventory/:id/restock` |
| Customers | `GET/POST /api/customers`, `PUT/DELETE /api/customers/:id` |
| Suppliers | `GET/POST /api/suppliers`, `PUT/DELETE /api/suppliers/:id` |
| Employees | `GET/POST /api/employees`, `PUT/DELETE /api/employees/:id` (Admin/Manager only to write) |
| Settings | `GET/PUT /api/settings` (Admin/Manager only to write) |
| Reports | `GET /api/reports/summary` |

Auth details:

- `POST /api/auth/login` returns a short-lived **access token** (1h) plus a
  **refresh token** (30d). On login it's rate-limited (20 attempts / 15 min).
- `POST /api/auth/refresh` exchanges a valid refresh token for a fresh token
  pair. The user is re-read from the DB, so deactivated accounts and role
  changes take effect immediately — a failed refresh means you need to log in
  again.
- `PUT /api/auth/password` lets a signed-in user change their own password
  (requires `currentPassword` + `newPassword`, min 8 chars).

Creating an order computes subtotal/tax/total **server-side** from the
current VAT rate — never trust a client-sent total for money. Marking an
order `Paid` requires a `method` (`Cash`, `Mobile Money`, or `Card`).

## 7. Analytics

`GET /api/reports/summary` now powers the whole Dashboard, Reports page, and
Sales & Payments KPIs with real data (no more static demo numbers):

- `totalRevenue`, `transactions`, `averageOrderValue` — all-time paid sales.
- `today: { sales, orders, customers }` — today's figures (server's local
  calendar day), shown on the Dashboard KPI cards.
- `salesByDay` — the last 7 days of paid sales, used for the sales chart.
- `topSellers` — top 5 menu items by units sold.
- `lowStockItems`, `methodTotals`, `tableStatusCounts`, `categoryUnitsSold`.

The seed script (`npm run seed`) now also inserts 15 demo orders spread across
the last week so the reports, chart, and "today" KPIs have something to show.

## 8. Known limitations

- Single-tenant: this whole app models one restaurant. Multi-location support
  would need a `restaurant_id` on every table.
- Inventory is decoupled from orders: placing an order doesn't decrement stock.
- Access tokens live in `localStorage` (or `sessionStorage` if "Remember me"
  was unchecked) and roles are read from the JWT, so a role change needs a
  refresh/login to take effect.

## 9. Deploying behind a reverse proxy

If this server sits behind nginx, Render, Railway, or any other reverse
proxy (see section 3), set `TRUST_PROXY=true` in `.env`. Without it,
`express-rate-limit` sees the proxy's IP for every request instead of each
visitor's real IP, so the login rate limit ends up shared across everyone
instead of per-person. Leave it `false` for local development or if this
process is directly internet-facing with no proxy in front — enabling it
without an actual proxy lets a client spoof its IP via the
`X-Forwarded-For` header.
