// Exact TM hit helper (thin, uses tm store). Kept separate so route.js stays clean.

function exactHit(tm, raw) {
  const e = tm.exactLookup(raw);
  if (!e) return null;
  if (e.status !== 'translated' || !e.translated) return null;
  return e;
}

module.exports = { exactHit };
