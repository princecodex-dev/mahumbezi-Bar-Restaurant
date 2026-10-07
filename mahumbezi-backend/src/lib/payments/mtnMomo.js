/**
 * MTN Mobile Money (MoMo) Collections API — STUB.
 *
 * Not implemented: this file defines the interface `payments/index.js`
 * expects and documents exactly what's needed to make it real. It
 * intentionally throws rather than pretending to succeed.
 *
 * To implement this for real:
 *   1. Register at https://momodeveloper.mtn.com and subscribe to the
 *      "Collections" product to get a Primary/Secondary Key.
 *   2. Create an API user + API key against the sandbox
 *      (POST /v1_0/apiuser, POST /v1_0/apiuser/{id}/apikey).
 *   3. Get an access token (POST /collection/token/) before each request,
 *      or cache it until it expires.
 *   4. Request a payment: POST /collection/v1_0/requesttopay with the
 *      customer's MoMo phone number and this order's amount.
 *   5. Poll GET /collection/v1_0/requesttopay/{referenceId} (or configure a
 *      webhook, if MTN's sandbox supports one for your account) until the
 *      status is SUCCESSFUL or FAILED, and map that to the `charge()`
 *      return shape below.
 *   6. Move from the sandbox host to MTN's production host, and swap the
 *      subscription key, only after MTN approves your production access
 *      request — that's a manual review on their side, budget time for it.
 *
 * Required environment variables once implemented:
 *   MTN_MOMO_SUBSCRIPTION_KEY, MTN_MOMO_API_USER, MTN_MOMO_API_KEY,
 *   MTN_MOMO_TARGET_ENVIRONMENT ("sandbox" | "mtnrwanda"), MTN_MOMO_BASE_URL
 */

async function charge({ orderId, amount }) {
  throw new Error(
    "MTN MoMo is not implemented yet — see src/lib/payments/mtnMomo.js for what's needed. " +
    "Set PAYMENT_PROVIDER_MODE=mock (the default) until this is finished."
  );
}

module.exports = { charge };
