// computeNorm: a single, language-aware cleaning routine used for BOTH the
// translation-memory lookup key AND history merge identity. Keeps OCR noise and
// cosmetic punctuation out of the key while preserving word-internal apostrophes
// (don't) and alphanumerics.

function foldWhitespace(s) {
  return String(s || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

// Leading/trailing punctuation set applied to each token.
const EDGE_PUNCT = new Set([
  '.', ',', '!', '?', ';', ':', '-', '_', '=', '|', '"', "'",
  '\u2018', '\u2019', '\u201c', '\u201d', '\u2014', '\u2013',
  '(', ')', '[', ']', '{', '}', '<', '>', '/', '\\', '~', '`', '@', '#', '$',
  '%', '^', '&', '*', '+', '\u00b7', '\u2026', '\u300a', '\u300b', '\u3001',
  '\u3002', '\uff01', '\uff1f', '\uff1b', '\uff1a',
]);

function stripEdge(c) {
  return EDGE_PUNCT.has(c);
}

// Detect whether the source is a CJK language (no space-separated tokens).
function isCjkLang(lang) {
  const l = String(lang || 'English').toLowerCase();
  return /zh|中文|chinese|ja|japanese|ko|korean|jp|kr/.test(l);
}

function computeNorm(raw, sourceLang) {
  const text = foldWhitespace(raw);
  if (!text) return '';
  const lang = sourceLang || 'English';
  if (isCjkLang(lang)) {
    // CJK: no token boundaries by space; strip edge punctuation but keep CJK
    // glyphs and latin/digits inside. Lowercasing latin is harmless.
    return text.toLowerCase().replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');
  }
  // Western (space-tokenised): token-by-token edge stripping.
  const tokens = text.split(' ');
  const cleaned = tokens
    .map((tok) => {
      if (!tok) return '';
      let a = 0;
      let b = tok.length - 1;
      while (a <= b && stripEdge(tok[a])) a++;
      while (b >= a && stripEdge(tok[b])) b--;
      // If punctuation removed from both ends left nothing but internal symbols,
      // keep interior (word-internal apostrophes like don't survive because they
      // are not at an edge).
      return tok.slice(a, b + 1);
    })
    .filter(Boolean);
  return cleaned.join(' ').toLowerCase();
}

module.exports = { computeNorm, foldWhitespace, isCjkLang };
