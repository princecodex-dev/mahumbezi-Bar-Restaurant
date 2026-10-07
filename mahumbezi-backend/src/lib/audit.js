const db = require("./db");

const insert = db.prepare(
  `INSERT INTO activity_log (user_id, user_name, action, entity, entity_id, detail)
   VALUES (?, ?, ?, ?, ?, ?)`
);

/**
 * Record an audit trail entry. Never throws — a logging failure should
 * never break the request that triggered it.
 *
 * @param {object} req - Express request; req.user (if present) is recorded
 *   as the actor. Pass null for system/unauthenticated actions (e.g. a
 *   failed login attempt).
 * @param {string} action - e.g. "order.paid", "menu_item.delete"
 * @param {object} [opts]
 * @param {string} [opts.entity] - e.g. "order"
 * @param {string|number} [opts.entityId]
 * @param {string} [opts.detail] - short human-readable summary
 */
function log(req, action, opts = {}) {
  try {
    const user = req && req.user;
    insert.run(
      user ? user.id : null,
      user ? user.name : null,
      action,
      opts.entity || null,
      opts.entityId != null ? String(opts.entityId) : null,
      opts.detail || null
    );
  } catch (err) {
    console.error("[audit] failed to record entry:", err.message);
  }
}

module.exports = { log };
