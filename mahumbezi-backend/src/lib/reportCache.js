// Tiny in-process TTL cache for GET /reports/summary.
// Every write route that feeds the summary invalidates it, so results are
// never stale beyond a single mutation; repeated dashboard/reports reads are
// served from memory instead of re-aggregating every order.
const TTL_MS = Number(process.env.REPORTS_CACHE_TTL_MS) || 10000;

let cache = null;

function get() {
  if (!cache) return null;
  if (Date.now() - cache.at >= TTL_MS) {
    cache = null;
    return null;
  }
  return cache.value;
}

function set(value) {
  cache = { at: Date.now(), value };
}

function invalidate() {
  cache = null;
}

module.exports = { get, set, invalidate };