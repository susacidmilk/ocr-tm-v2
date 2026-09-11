// Batch translator: split a long recorded transcript into chunks, send each
// chunk as one numbered DeepSeek request, and align the returned JSON array back
// to the original lines with a strict length check. Any failed chunk is retried
// by bisection down to single lines. Results are returned PER LINE so a half that
// succeeds is never discarded when its sibling half fails.

const { withDeadline } = require('./deadline');

const isOkStr = (v) => typeof v === 'string' && v.trim() !== '';

// Does source vs target differ enough that identical output signals a model
// "echo" rather than a legitimate same-string translation?
const sameLang = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Normalise lightly for echo comparison (whitespace/case only; a genuine name that
// should be kept will still compare equal here and is accepted after one retry).
function echoNormalize(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Align a parsed array to `lines`. Returns {ok:boolean, translated:(string|null)[]}.
function alignResult(lines, arr) {
  if (!Array.isArray(arr)) {
    return { ok: false, translated: lines.map(() => null) };
  }
  const translated = [];
  for (let i = 0; i < lines.length; i++) {
    const v = arr[i];
    translated.push(isOkStr(v) ? v.trim() : null);
  }
  const ok = translated.length === lines.length && translated.every((t) => t != null);
  return { ok, translated };
}

// Translate a group of lines, returning a per-line (string|null)[] plus error info.
// Internal: never throws away successfully translated lines.
async function translateLinesInner(provider, lines, opts, depth) {
  const result = lines.map(() => null);
  const srcLang = opts && opts.sourceLang;
  const tgtLang = opts && opts.targetLang;
  const wantEchoGuard = !sameLang(srcLang, tgtLang);

  // 1) Try the whole group as one batch.
  let batchAttempted = false;
  if (lines.length > 0) {
    try {
      const arr = await withDeadline(
        provider.translateBatch(lines, opts),
        190000,
        '批量请求超时'
      );
      const r = alignResult(lines, arr);
      if (r.ok) {
        // Echo guard: a line that came back byte-identical to its source while the
        // languages differ is usually the model "echoing" instead of translating.
        // Retry each such line once via the single-line (cleaner) prompt.
        const echoIdx = [];
        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i];
          const t = r.translated[i];
          if (wantEchoGuard && t != null && echoNormalize(t) === echoNormalize(raw)) {
            echoIdx.push(i);
          }
        }
        if (echoIdx.length && echoIdx.length < lines.length) {
          for (const i of echoIdx) result[i] = null; // will retry individually
        } else if (echoIdx.length === lines.length) {
          // everything echoed -> treat whole batch as failed, bisect
          throw new Error('模型整批未翻译（返回原文），二分重试');
        } else {
          for (let i = 0; i < lines.length; i++) result[i] = r.translated[i];
          return { translated: result, errors: 0 };
        }
      } else {
        throw new Error('batch-aligned=false'); // triggers bisection path
      }
    } catch {
      /* batch failed -> fall through to bisection / single retry */
    }
    batchAttempted = true;
  }

  // For a mixed batch (only some lines echoed), retry the echoed lines singly via
  // the single-line streaming prompt; accept them even if they still echo (they
  // may be names that legitimately stay as-is).
  const needsSingle = result.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  if (needsSingle.length && needsSingle.length < lines.length) {
    for (const i of needsSingle) {
      try {
        const text = await withDeadline(
          provider.translateLine(lines[i], opts),
          120000,
          '单句重试超时'
        );
        const t = String(text || '').trim();
        if (t) result[i] = t;
      } catch {
        /* leave null -> error below */
      }
    }
    return { translated: result, errors: result.filter((v) => v == null).length };
  }

  // 2) Single line (whole group was one line): last resort = translateLine.
  if (lines.length === 1) {
    if (batchAttempted) {
      // batch route failed for the lone line; try a streaming single call
      try {
        const text = await withDeadline(
          provider.translateLine(lines[0], opts),
          120000,
          '单句翻译超时'
        );
        const t = String(text || '').trim();
        if (t) {
          result[0] = t;
          return { translated: result, errors: 0 };
        }
      } catch {
        /* ignore */
      }
    }
    return { translated: result, errors: 1 };
  }

  // 3) Multi-line: bisect and translate each half, preserving partial success.
  const mid = Math.ceil(lines.length / 2);
  const left = await translateLinesInner(provider, lines.slice(0, mid), opts, depth + 1);
  const right = await translateLinesInner(provider, lines.slice(mid), opts, depth + 1);
  const translated = [...left.translated, ...right.translated];
  const errors = left.errors + right.errors;
  return { translated, errors };
}

/**
 * Split `total` lines into as-equal-as-possible chunk sizes, each ~`target`
 * (and none oversized). Sizes differ by at most 1.
 */
function equalSplitSizes(total, target) {
  if (!total || total <= 0) return [];
  const t = Math.max(1, Math.round(Number(target) || 70));
  if (total <= t) return [total];
  // pick k so each chunk is close to the target but never > 110
  let k = Math.round(total / t);
  if (k < 1) k = 1;
  const MAX = 110;
  while (k > 1 && Math.ceil(total / k) > MAX) k++;
  const base = Math.floor(total / k);
  const sizes = new Array(k).fill(base);
  let rem = total - base * k;
  for (let i = 0; i < rem; i++) sizes[i] += 1;
  return sizes;
}

// run async tasks (that return promises) with at most `limit` in flight.
async function pool(items, limit, worker) {
  const limitN = Math.max(1, Number(limit) || 1);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  };
  const runners = [];
  for (let i = 0; i < Math.min(limitN, items.length); i++) runners.push(run());
  await Promise.all(runners);
}

/**
 * Translate an ordered list of raw lines into the TM (one entry per line).
 *
 * @param deps.provider  translate provider (deepseek/lmstudio)
 * @param deps.tm        TM store for the target game
 * @param deps.settings  settings (model/src reporting + tmBatchConcurrency)
 * @param deps.glossaryText optional terminology constraints
 * @param deps.onProgress (info) -> void
 * @param lines ordered raw lines (already de-duped)
 * @param batchSize target lines per request (auto-equal split 70..110)
 */
async function translateTranscriptInto(deps, lines, batchSize = 70) {
  const { provider, tm, settings, onProgress, glossaryText } = deps;
  const results = [];
  const errors = [];
  const total = lines.length;
  const sizes = equalSplitSizes(total, batchSize);
  // per-chunk running counters, keyed by original chunk index
  const okCounts = new Array(sizes.length).fill(0);
  let completedChunks = 0;

  await pool(sizes, settings && settings.tmBatchConcurrency, async (size, ci) => {
    const chunk = lines.slice(sumOf(sizes, ci), sumOf(sizes, ci) + size);
    const base = sumOf(sizes, ci);
    onProgress && onProgress({ chunk: ci + 1, total: sizes.length, status: 'translating', done: sumOf(okCounts) });
    const { translated, errors: chunkErrors } = await translateLinesInner(
      provider,
      chunk,
      {
        glossaryText,
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
      },
      0
    );
    const model = settings.sources && settings.sources[provider.key] ? settings.sources[provider.key].model : provider.key;
    let localOk = 0;
    chunk.forEach((raw, k) => {
      const tr = translated[k];
      const src = base + k;
      if (tr) {
        const entry = tm.upsert({
          raw,
          translated: tr,
          model,
          src: provider.key,
          meta: { chunk: ci + 1, idx: src },
        });
        results.push({ raw, translated: tr, entry, viaFallback: false });
        localOk++;
      } else {
        const entry = tm.upsert({ raw, status: 'error', src: provider.key, error: '翻译失败（单句/批量均未成功）' });
        results.push({ raw, translated: null, entry, viaFallback: false });
      }
    });
    okCounts[ci] = localOk;
    completedChunks++;
    if (chunkErrors > 0) {
      errors.push({ chunk: ci + 1, count: chunkErrors });
      onProgress && onProgress({ chunk: ci + 1, total: sizes.length, status: 'failed', done: sumOf(okCounts), error: `${chunkErrors} 条失败` });
    } else {
      onProgress && onProgress({ chunk: ci + 1, total: sizes.length, status: 'done', done: sumOf(okCounts) });
    }
  });

  return { results, errors, ok: sumOf(okCounts), totalLines: total, totalChunks: sizes.length };
}

function sumOf(arr, upto) {
  if (upto == null) return arr.reduce((a, b) => a + (b || 0), 0);
  let s = 0;
  for (let i = 0; i < upto; i++) s += arr[i] || 0;
  return s;
}

module.exports = { translateTranscriptInto, alignResult, translateLinesInner, equalSplitSizes, pool };
