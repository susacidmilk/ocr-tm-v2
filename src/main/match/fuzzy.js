// Fuzzy/suspect-hit search: when an exact hit fails, find high-similarity
// candidates in the same game's TM so the user can confirm. Never auto-applies.

// Levenshtein distance for short strings.
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function similarity(a, b) {
  if (a === b) return 1;
  const len = Math.max(a.length, b.length);
  if (len === 0) return 1;
  const dist = editDistance(a, b);
  return 1 - dist / len;
}

// Candidate threshold: similarity >= threshold, and not exact (exact handled elsewhere).
function suspectCandidates(tm, raw, threshold = 0.85, max = 5) {
  const target = tm.normOf(raw);
  if (!target) return [];
  const out = [];
  for (const [, e] of tm.allByNorm()) {
    if (e.status !== 'translated' || !e.translated) continue;
    if (e.norm === target) continue;
    const sim = similarity(target, e.norm);
    if (sim >= threshold) {
      out.push({ id: e.id, raw: e.raw, translated: e.translated, norm: e.norm, similarity: sim });
      if (out.length >= max) break;
    }
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out.slice(0, max);
}

module.exports = { editDistance, similarity, suspectCandidates };
