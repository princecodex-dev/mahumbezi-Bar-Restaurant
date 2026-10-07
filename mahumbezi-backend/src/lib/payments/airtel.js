/**
 * Airtel Money API — STUB.
 *
 * Not implemented: this file defines the interface `payments/index.js`
 * expects and documents exactly what's needed to make it real. It
 * intentionally throws rather than pretending to succeed.
 *
 * To implement this for real:
 *   1. Register at https://developers.airtel.africa and create an app to
 *      get a Client ID + Client Secret for the "Collections" (merchant
 *      payment) API, scoped to Rwanda.
 *   2. Get an OAuth2 access token: POST /auth/oauth2/token with your
 *      client credentials, cache it until it expires.
 *   3. Request a payment: POST /merchant/v1/payments/ with the customer's
 *      Airtel Money number and this order's amount, in the headers Airtel
 *      requires (X-Country, X-Currency, etc.).
 *   4. Check status: GET /standard/v1/payments/{transactionId} until it
 *      resolves, and map that to the `charge()` return shape below.
 *   5. Move from Airtel's sandbox/UAT host to production only after their
 *      approval process — again, a manual review on their side.
 *
 * Required environment variables once implemented:
 *   AIRTEL_CLIENT_ID, AIRTEL_CLIENT_SECRET, AIRTEL_COUNTRY ("RW"),
 *   AIRTEL_CURRENCY ("RWF"), AIRTEL_BASE_URL
 */

async function charge({ orderId, amount }) {
  throw new Error(
    "Airtel Money is not implemented yet — see src/lib/payments/airtel.js for what's needed. " +
    "Set PAYMENT_PROVIDER_MODE=mock (the default) until this is finished."
  );
}

module.exports = { charge };
