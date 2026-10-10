const crypto = require("crypto");
const { jsonFetch, basicAuth, makeTokenCache } = require("./gateway");
const { normalizeMsisdn } = require("./config");

/**
 * MTN Mobile Money (MoMo) Collections API — Request to Pay.
 *
 * Flow used here:
 *   1. POST /token/            -> bearer token (cached until it expires)
 *   2. POST /v1_0/requesttopay -> 202 + our own X-Reference-Id; the customer
 *                                 gets a prompt on their handset
 *   3. GET  /v1_0/requesttopay/{ref} -> poll until SUCCESSFUL / FAILED
 *
 * Credentials (only the restaurant owner can obtain these — see README.md):
 *   MTN_MOMO_SUBSCRIPTION_KEY   Collections product subscription key
 *   MTN_MOMO_API_USER           API user id
 *   MTN_MOMO_API_KEY            API key for that user
 *   MTN_MOMO_TARGET_ENVIRONMENT sandbox | mtnrwanda   (default: sandbox)
 *   MTN_MOMO_BASE_URL           optional full override of the collections host
 *   MTN_MOMO_CALLBACK_URL       optional; MTN pushes a status callback here
 *                                if set (polling still runs regardless)
 */

const name = "mtn_momo";

function baseUrl() {
  if (process.env.MTN_MOMO_BASE_URL) return process.env.MTN_MOMO_BASE_URL.replace(/\/$/, "");
  const target = (process.env.MTN_MOMO_TARGET_ENVIRONMENT || "sandbox").toLowerCase();
  return target === "sandbox"
    ? "https://sandbox.momodeveloper.mtn.com/collection"
    : "https://proxy.momodeveloper.mtn.com/collection";
}

function targetEnvironment() {
  return (process.env.MTN_MOMO_TARGET_ENVIRONMENT || "sandbox").toLowerCase();
}

/**
 * The MTN sandbox only settles a handful of currencies and rejects RWF
 * outright with INVALID_CURRENCY, so sandbox testing would otherwise always
 * fail for a Rwandan restaurant. Production accepts RWF normally.
 *
 * The override is therefore applied only against the sandbox, and charge()
 * reports back the currency it actually sent so the ledger stays truthful.
 * Set MTN_MOMO_SANDBOX_CURRENCY to override the EUR default.
 */
function resolveCurrency(currencyCode) {
  const requested = String(currencyCode || "RWF");
  if (targetEnvironment() !== "sandbox") return requested;
  const override = (process.env.MTN_MOMO_SANDBOX_CURRENCY || "EUR").trim().toUpperCase();
  return override || requested;
}

function subscriptionKey() {
  const key = (process.env.MTN_MOMO_SUBSCRIPTION_KEY || "").trim();
  if (!key) {
    throw new Error(
      "MTN MoMo is selected but MTN_MOMO_SUBSCRIPTION_KEY is not set. " +
        "Get credentials at https://momodeveloper.mtn.com, or set PAYMENT_PROVIDER_MODE=mock."
    );
  }
  return key;
}

function requireCredentials() {
  const apiUser = (process.env.MTN_MOMO_API_USER || "").trim();
  const apiKey = (process.env.MTN_MOMO_API_KEY || "").trim();
  if (!apiUser || !apiKey) {
    throw new Error(
      "MTN MoMo is selected but MTN_MOMO_API_USER / MTN_MOMO_API_KEY are not set. " +
        "Create an API user + key for the Collections product, or set PAYMENT_PROVIDER_MODE=mock."
    );
  }
  subscriptionKey();
  return { apiUser, apiKey };
}

const getAccessToken = makeTokenCache(async () => {
  const { apiUser, apiKey } = requireCredentials();
  const body = await jsonFetch(
    `${baseUrl()}/token/`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuth(apiUser, apiKey),
        "Ocp-Apim-Subscription-Key": subscriptionKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    },
    "MTN MoMo token"
  );
  return {
    token: body && body.access_token,
    expiresInMs: (body && Number(body.expires_in) ? Number(body.expires_in) : 300) * 1000,
  };
});

/**
 * Push a payment request to the customer's MoMo wallet.
 * Returns { reference, currency } — the X-Reference-Id to poll with, plus the
 * currency that was actually sent (differs from the request in the sandbox).
 */
async function charge({ orderId, amount, currency, phone }) {
  const msisdn = normalizeMsisdn(phone);
  if (!msisdn) throw new Error("MTN MoMo needs the customer's phone number to push the payment prompt");

  const reference = crypto.randomUUID();
  const token = await getAccessToken();
  const currencyCode = resolveCurrency(currency);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Ocp-Apim-Subscription-Key": subscriptionKey(),
    "X-Reference-Id": reference,
    "X-Target-Environment": targetEnvironment(),
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  };
  const callback = (process.env.MTN_MOMO_CALLBACK_URL || "").trim();
  if (callback) headers["X-Callback-Url"] = callback;

  await jsonFetch(
    `${baseUrl()}/v1_0/requesttopay`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        amount: String(amount),
        currency: currencyCode,
        externalId: String(orderId),
        payer: { partyIdType: "MSISDN", partyId: msisdn },
        payerMessage: `Payment for order ${orderId}`,
        payeeNote: `Order ${orderId}`,
      }),
    },
    "MTN MoMo request to pay"
  );

  return { reference, currency: currencyCode };
}

const TERMINAL = {
  SUCCESSFUL: "succeeded",
  FAILED: "failed",
  REJECTED: "failed",
  TIMEOUT: "failed",
  TIMEDOUT: "failed",
  CANCELLED: "failed",
};

/** Poll one RequestToPay. Returns { status: pending|succeeded|failed, message? }. */
async function status(reference) {
  const token = await getAccessToken();
  const body = await jsonFetch(
    `${baseUrl()}/v1_0/requesttopay/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": subscriptionKey(),
        "X-Target-Environment": targetEnvironment(),
      },
    },
    "MTN MoMo transaction status"
  );

  const raw = String((body && body.status) || "PENDING").toUpperCase();
  const mapped = TERMINAL[raw] || "pending";
  return { status: mapped, message: mapped === "pending" ? null : `MTN MoMo: ${raw}` };
}

module.exports = { name, charge, status, baseUrl };
