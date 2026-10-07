# Payments

## What works today

Every order marked **Paid** — regardless of method (Cash, Card, Mobile
Money) — gets a row in `payment_transactions` via `recordPayment()` in
`index.js`. For Cash and Card this is just a log of what the staff member
collected in person; there's no external system involved, so it's recorded
as `succeeded` immediately.

Mobile Money is recorded the same way by default (`PAYMENT_PROVIDER_MODE`
unset or `mock`) — the staff member is asserting the customer paid via MoMo
or Airtel Money, and that's logged with `provider = "mock"` so it's never
confused with a transaction a real gateway actually verified.

## What's stubbed, not working

`mtnMomo.js` and `airtel.js` define the interface `index.js` expects
(`charge({ orderId, amount }) -> { provider, reference, status }`) but both
just `throw`. Real integration needs:

- Real merchant credentials from MTN and/or Airtel (registration + their
  approval process — see the comment at the top of each file for exact
  steps and required env vars)
- Deciding whether to poll their status endpoint or receive a webhook
- Handling the case where the customer's phone prompt times out or they
  decline — the order should stay unpaid, not silently succeed

## Turning on a real gateway once you have credentials

```
PAYMENT_PROVIDER_MODE=live
MOBILE_MONEY_PROVIDER=mtn_momo   # or airtel_money
# ...plus that provider's own env vars, see mtnMomo.js / airtel.js
```

With `PAYMENT_PROVIDER_MODE=live`, Cash and Card still bypass the gateway
(nothing to call) — only Mobile Money routes through the configured
provider, and a failed/thrown charge means the order is **not** marked Paid.
