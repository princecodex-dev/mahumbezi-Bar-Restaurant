const pino = require("pino");

// Plain JSON output everywhere — that's what a log aggregator (Render/
// Railway/journald/whatever) wants in production, and it's still readable
// piped through `npm install -D pino-pretty && node src/index.js | npx pino-pretty`
// locally if you want color. Not bundling pino-pretty as a dependency keeps
// the production install smaller.
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    // Never let a request/response body containing these slip into logs.
    paths: [
      "req.headers.authorization",
      "req.body.password",
      "req.body.currentPassword",
      "req.body.newPassword",
      "req.body.refreshToken",
    ],
    remove: true,
  },
});

module.exports = logger;
