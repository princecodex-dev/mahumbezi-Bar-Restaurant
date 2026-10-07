const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Refresh tokens are only valid at POST /api/auth/refresh. Without this
    // check, a leaked 30-day refresh token could be used directly as a
    // 30-day access token on every other route.
    if (decoded && decoded.type === "refresh") {
      return res.status(401).json({ error: "This is a refresh token, not an access token" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Usage: requireRole("Admin", "Manager")
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
