const { OAuth2Client } = require("google-auth-library");

// The client ID is a *public* identifier (it is sent to the browser), not a
// secret. No client secret is needed for the Google Identity Services ID-token
// flow. Read once at startup; restart the server after changing .env.
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();

const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function isConfigured() {
  return Boolean(GOOGLE_CLIENT_ID);
}

function googleError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Verify a Google ID token (the `credential` string returned by Google
 * Identity Services on the frontend) using Google's own verification library.
 *
 * google-auth-library checks the signature against Google's rotating public
 * keys, plus the issuer (`iss`), audience (`aud` === our client ID) and
 * expiry — so nothing the frontend sends is trusted until this passes.
 *
 * Resolves to the verified profile. Throws an Error with a `.code` and
 * `.status` on any failure (never exposing the raw token).
 */
async function verifyCredential(credential) {
  if (!client) {
    throw googleError(
      "Google sign-in is not configured on this server.",
      "GOOGLE_NOT_CONFIGURED",
      503
    );
  }
  if (typeof credential !== "string" || !credential.trim()) {
    throw googleError("Missing Google credential.", "MISSING_CREDENTIAL", 400);
  }

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
  } catch (err) {
    throw googleError("Invalid or expired Google credential.", "INVALID_CREDENTIAL", 401);
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw googleError(
      "Google account did not provide a usable email address.",
      "GOOGLE_NO_EMAIL",
      400
    );
  }
  if (payload.email_verified === false) {
    throw googleError(
      "Your Google email address is not verified.",
      "GOOGLE_EMAIL_NOT_VERIFIED",
      400
    );
  }

  return {
    googleId: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    name: payload.name || String(payload.email).split("@")[0],
    picture: payload.picture || null,
    emailVerified: payload.email_verified === true,
  };
}

module.exports = { isConfigured, verifyCredential, GOOGLE_CLIENT_ID };
