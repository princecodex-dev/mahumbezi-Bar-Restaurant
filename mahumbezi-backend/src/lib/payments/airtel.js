const { jsonFetch, basicAuth, makeTokenCache } = require("./gateway");
const { normalizeMsisdn } = require("./config");

/**
 * Airtel Money merchant collections API.
 *
 * Flow used here:
 *   1. POST /auth/oauth2/token        -> bearer token (cached until expiry)
 *   2. POST /merchant/v1/payments/    -> pushes a prompt to the customer's
 *                                        Airtel Money wallet, returns a
 *                                        transactionId
 *   3. GET  /standard/v1/payments/{id} -> poll until Successful / Failed
 *
 * Credentials (from https://developers.airtel.africa, Rwanda Op-Co):
 *   AIRTEL_CLIENT_ID
 *   AIRTEL_CLIENT_SECRET
 *   AIRTEL_COUNTRY     default "RW"
 *   AIRTEL_CURRENCY    default "RWF"
 *   AIRTEL_ENV         "sandbox" | "production"   (default: production)
 *   AIRTEL_BASE_URL    optional full override of the host
 *   AIRTEL_NOTIFY_URL  optional notificationUrl (Airtel's callback)
 *
 * NOTE ON RESPONSE SHAPES: Airtel has shipped v1 and v2 of these endpoints
 * with slightly different field names. The parsing below deliberately reads
 * several plausible keys rather than exactly one. Confirm against a real
 * sandbox transaction before taking real money — see README.md.
 */

const name = "airtel_money";

function baseUrl() {
  if (process.env.AIRTEL_BASE_URL) return process.env.AIRTEL_BASE_URL.replace(/\/$/, "");
  const env = (process.env.AIRTEL_ENV || "production").toLowerCase();
  return env === "sandbox" || env === "uat"
    ? "https://openapiuat.airtel.africa"
    : "https://openapi.airtel.africa";
}

function country() {
  return (process.env.AIRTEL_COUNTRY || "RW").toUpperCase();
}

function payCurrency() {
  return (process.env.AIRTEL_CURRENCY || "RWF").toUpperCase();
}

function requireCredentials() {
  const clientId = (process.env.AIRTEL_CLIENT_ID || "").trim();
  const clientSecret = (process.env.AIRTEL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Airtel Money is selected but AIRTEL_CLIENT_ID / AIRTEL_CLIENT_SECRET are not set. " +
        "Create an app at https://developers.airtel.africa, or set PAYMENT_PROVIDER_MODE=mock."
    );
  }
  return { clientId, clientSecret };
}

const getAccessToken = makeTokenCache(async () => {
  const { clientId, clientSecret } = requireCredentials();
  const body = await jsonFetch(
    `${baseUrl()}/auth/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuth(clientId, clientSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    },
    "Airtel Money token"
  );
  return {
    token: body && body.access_token,
    expiresInMs: (body && Number(body.expires_in) ? Number(body.expires_in) : 300) * 1000,
  };
});

/**
 * Push a payment request to the customer's Airtel Money wallet.
 * Returns { reference } — the transactionId to poll with.
 */
async function charge({ orderId, amount, phone }) {
  const msisdn = normalizeMsisdn(phone);
  if (!msisdn) throw new Error("Airtel Money needs the customer's phone number to push the payment prompt");

  const token = await getAccessToken();
  const body = await jsonFetch(
    `${baseUrl()}/merchant/v1/payments/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Country": country(),
        "X-Currency": payCurrency(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: String(amount),
        country: country(),
        currency: payCurrency(),
        msisdn,
        reference: `order-${orderId}`,
        ...(process.env.AIRTEL_NOTIFY_URL ? { notificationUrl: process.env.AIRTEL_NOTIFY_URL } : {}),
        customer: { phone: msisdn },
      }),
    },
    "Airtel Money payment"
  );

  const code = body && body.status && String(body.status.code || "");
  const reference =
    (body && body.data && (body.data.transactionId || body.data.reference || body.data.transaction_id)) || null;

  if (code && !code.startsWith("SUC")) {
    throw new Error(`Airtel Money: ${code} ${body.status.message || "declined"}`);
  }
  if (!reference) {
    throw new Error(`Airtel Money accepted the request but returned no transaction id (${code || "no code"})`);
  }

  return { reference };
}

/** Poll one payment. Returns { status: pending|succeeded|failed, message? }. */
async function status(reference) {
  const token = await getAccessToken();
  const body = await jsonFetch(
    `${baseUrl()}/standard/v1/payments/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Country": country(),
        "X-Currency": payCurrency(),
      },
    },
    "Airtel Money transaction status"
  );

  const data = (body && body.data) || {};
  const raw = String(data.status ?? data.transactionStatus ?? data.state ?? "PENDING");
  const lower = raw.toLowerCase();

  if (lower.includes("success")) return { status: "succeeded", message: `Airtel Money: ${raw}` };
  if (lower.includes("fail") || lower.includes("reject") || lower.includes("cancel") || lower.includes("error")) {
    return { status: "failed", message: `Airtel Money: ${raw}` };
  }
  return { status: "pending", message: null };
}

module.exports = { name, charge, status, baseUrl };
