/**
 * Shared plumbing for the two mobile-money gateways: a fetch wrapper that
 * turns a non-2xx response into an Error carrying the provider's own message
 * (that message is what the cashier ends up seeing), plus an expiring bearer
 * token cache — both MTN and Airtel issue short-lived OAuth tokens and charge
 * per-request, so refetching one for every status poll is wasteful.
 */

async function jsonFetch(url, options = {}, label = "payment gateway") {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(`${label}: could not reach ${safeHost(url)} (${err.message})`);
  }

  const text = await res.text().catch(() => "");
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const detail =
      (body && (body.message || body.error_description || body.error || (body.status && body.status.message))) ||
      text.slice(0, 300) ||
      res.statusText;
    const err = new Error(`${label}: ${res.status} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    err.status = res.status;
    throw err;
  }

  return body;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Bas64 for HTTP Basic auth, used by both token endpoints. */
function basicAuth(id, secret) {
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

/**
 * Returns an async () => accessToken that renews only when the cached one is
 * within `skewMs` of expiring.
 */
function makeTokenCache(fetchToken, { skewMs = 60000 } = {}) {
  let token = null;
  let expiresAt = 0;
  return async function getAccessToken() {
    if (token && Date.now() < expiresAt - skewMs) return token;
    const result = await fetchToken();
    token = result.token;
    expiresAt = Date.now() + (result.expiresInMs || 5 * 60 * 1000);
    return token;
  };
}

module.exports = { jsonFetch, basicAuth, makeTokenCache };
