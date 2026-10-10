# Payments

## What works today

Every order marked **Paid** gets a row in `payment_transactions` via
`recordPayment()` in `index.js`. The ledger also carries `method`,
`currency`, `customer_phone`, `taken_by` and `error` (migration 012).

| Method | Behaviour |
| --- | --- |
| Cash, Card | Physical money already changed hands — recorded as `succeeded` immediately. Never routes through a gateway. |
| MTN MoMo, Airtel Money (unset/`mock`) | Same as Cash: a staff-asserted payment, logged with `provider = "mock"` so it's never mistaken for one a gateway verified. |
| MTN MoMo, Airtel Money (`live`) | A real collection is pushed to the customer's phone. The row starts `pending`; the order is **not** marked Paid until the gateway reports success. |
| Mobile Money (legacy) | Accepted for older clients but carries no network of its own, so it resolves to whichever `MOBILE_MONEY_PROVIDER` names. The cashier's screen offers the two networks by name instead. |

The two networks are **separate methods**, so both can be live at once and the
ledger names the network that took the money. A phone's prefix tells you
nothing reliable — number portability means an MTN-issued number can sit on
Airtel — so the cashier picks the network rather than the code inferring it.

> **Invariant:** only `cash` and `card` are treated as offline
> (`OFFLINE_PROVIDERS`). Anything else **must** reach a gateway. Do not infer
> "offline" from "isn't mobile money" — the mobile-money methods are identified
> by their own provider names, and getting this wrong books money that was
> never collected. `tests/api.test.js` has a regression test for it.

## Guards

- **One successful payment per order**, enforced by a partial unique index
  (`ux_payment_txn_succeeded_order`, migration 012) *and* a status re-read
  inside the DB transaction in `src/lib/orderPaid.js`. A double-clicked
  Confirm button gets a 409 `ALREADY_PAID`, not a second charge.
- **A paid order cannot leave `Paid`.** Reversing money needs a refund flow,
  which does not exist yet — silently dropping an order from revenue while
  its payment row stays in the ledger would be worse than refusing.
- **Only Cashier / Admin / Manager may record a payment** (`PAYMENT_ROLES`
  here, enforced in `src/routes/orders.js`). Every other role gets a 403.

## Live mode: request → poll → settle

With `PAYMENT_PROVIDER_MODE=live`, Mobile Money works like this:

1. `PATCH /api/orders/:id/status` with `status: "Paid"` inserts a **pending**
   transaction *before* any network call, so a crash mid-charge leaves
   something to reconcile rather than nothing.
2. The provider pushes the prompt to the customer's phone and returns a
   reference.
3. We poll for up to `PAYMENT_SETTLE_BUDGET_MS` (default 15s).
   - Settled → the order is marked Paid, response `200`.
   - Still waiting → response `202` with `{ transactionId, orderId }`. The
     order stays **unpaid**; the cashier's screen then polls
     `GET /api/payments/:id`, which is the call that finally marks the order
     Paid once the customer enters their PIN.
   - Gateway rejected it → `502`, the row is `failed`, the order is unpaid.

Provider interface (both `mtnMomo.js` and `airtel.js` implement it):

```js
charge({ orderId, amount, currency, phone }) -> { reference, currency? }
status(reference)                            -> { status, message? }
// status: 'pending' | 'succeeded' | 'failed'
```

`currency` is echoed back when the gateway settled in a different currency
than the one requested — the MTN sandbox rejects RWF, so `mtnMomo.js` swaps in
`MTN_MOMO_SANDBOX_CURRENCY` and the ledger records what was really sent.

## Credentials

Only the restaurant owner can obtain these — see the comment at the top of
`mtnMomo.js` / `airtel.js` for the exact registration steps and required env
vars (also listed in `.env.example`).

**Test in sandbox first.** Both providers' sandbox/UAT environments use
different hosts and sometimes different response field names than production.
Airtel in particular has shipped v1 and v2 of these endpoints with differing
shapes; `airtel.js` parses several plausible keys rather than exactly one, and
that should be confirmed against a real sandbox transaction before real money
moves.

## Turning on a real gateway

Each network is switched on by its own credentials, so you can run one or both:

```
PAYMENT_PROVIDER_MODE=live
# MTN MoMo — MTN_MOMO_SUBSCRIPTION_KEY / _API_USER / _API_KEY
# Airtel   — AIRTEL_CLIENT_ID / _CLIENT_SECRET
# ...plus whichever of the above you have
```

`MOBILE_MONEY_PROVIDER` is only consulted for the legacy `Mobile Money` method;
it is no longer required when the cashier's screen sends `MTN MoMo` or
`Airtel Money` by name.

On Render, set these in the service's Environment panel (`render.yaml`
deliberately doesn't hold them).

**`AIRTEL_ENV` defaults to `production` when unset.** Leaving it blank while
adding Airtel credentials will hit the real API — set `sandbox` first.

## Not implemented (and deliberately not faked)

- Refunds / voids — no data model, no endpoint, no UI.
- Tips, bill splitting, partial payments, tendered/change, cash drawer.
- Webhooks — status is polled, not pushed. Both gateways can also push to a
  callback URL (`MTN_MOMO_CALLBACK_URL` / `AIRTEL_NOTIFY_URL`) if you set one,
  but nothing receives it yet.
- EBM fiscalisation — see `../ebm/README.md`.

## Reports

`/reports/summary` still derives revenue from `orders WHERE status = 'Paid'`,
**not** from this ledger. That's intentional for now: an order's status is
what the rest of the app (tables, awaiting counts, UI lists) keys off, and
making two sources disagree would be worse than keeping one. The Transaction
Ledger panel on Sales & Payments is where you see the payment rows themselves,
including failed and pending attempts that never produced a paid order.
