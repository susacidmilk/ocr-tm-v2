// Self-test for the batch translator core (chunking, numbered request, strict
// alignment, bisection fallback, TM write-back).
//
// Offline by default: uses a MOCK provider that pretends to be DeepSeek. If env
// OCR_TM_DEEPSEEK_KEY is set (and OCR_TM_LIVE=1), it also runs one real live
// DeepSeek batch as an integration check.
//
// Usage:
//   node scripts/selftest-batch.js
//   OCR_TM_DEEPSEEK_KEY=sk-... OCR_TM_LIVE=1 node scripts/selftest-batch.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTmManager } = require('../src/main/data/tm');
const { translateTranscriptInto } = require('../src/main/translate/batch');

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.error(`  FAIL ${label}`);
  }
}

// A mock provider that returns translations of the same length as its input,
// so alignment succeeds when lengths match.
function mockProvider({ failOn, failAfterBisect } = {}) {
  let calls = 0;
  return {
    key: 'deepseek',
    label: 'Mock DeepSeek',
    supportsStreaming: true,
    async translateBatch(lines) {
      calls++;
      if (failOn && lines.length === failOn) {
        const err = new Error('mock: simulated batch failure');
        err._mock = true;
        throw err;
      }
      return lines.map((l) => `【译】${l}`);
    },
    async translateLine(line) {
      return `【译】${line}`;
    },
    get calls() {
      return calls;
    },
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-tm-batch-'));
}

const settings = {
  sourceLang: 'English',
  targetLang: 'Simplified Chinese',
  sources: { deepseek: { model: 'deepseek-chat' } },
};

async function run() {
  // 1) happy path: even number, no failures -> all aligned in one chunk
  console.log('== happy path ==');
  {
    const dir = tmpDir();
    const mgr = createTmManager({ dataDir: dir, sourceLang: 'English' });
    const tm = mgr.forGame('Game A');
    const provider = mockProvider();
    const lines = [];
    for (let i = 0; i < 4; i++) lines.push(`Line ${i + 1} here.`);
    const { ok, errors, results } = await translateTranscriptInto(
      { provider, tm, settings, glossaryText: '' }, lines, 50
    );
    assert(ok === 4 && errors.length === 0, `translated all (ok=${ok})`);
    assert(results.length === 4, 'results length == input');
    assert(results[0].translated === '【译】Line 1 here.', 'mock translation applied');
    assert(tm.total() === 4, 'TM has 4 entries after batch');
    mgr.flushAll();
  }

  // 2) chunking: batchSize 2 -> 2 chunks
  console.log('== chunking ==');
  {
    const dir = tmpDir();
    const mgr = createTmManager({ dataDir: dir, sourceLang: 'English' });
    const tm = mgr.forGame('Game A');
    const provider = mockProvider();
    const lines = ['A one.', 'B two.', 'C three.', 'D four.', 'E five.'];
    const { totalChunks } = await translateTranscriptInto(
      { provider, tm, settings, glossaryText: '' }, lines, 2
    );
    assert(totalChunks === 3, 'chunks = ceil(5/2) = 3');
    assert(tm.total() === 5, 'all 5 in TM');
    mgr.flushAll();
  }

  // 3) batch failure triggers bisection down to single lines -> still all OK
  console.log('== bisection fallback ==');
  {
    const dir = tmpDir();
    const mgr = createTmManager({ dataDir: dir, sourceLang: 'English' });
    const tm = mgr.forGame('Game A');
    // Mock fails for a chunk of exactly 4 (so whole-4 fails), then 2 also fail? We
    // configure to fail only on size 4; bisection halves to size 2 (succeeds).
    const provider = mockProvider({ failOn: 4 });
    const lines = ['w one.', 'w two.', 'w three.', 'w four.'];
    const { ok, errors } = await translateTranscriptInto(
      { provider, tm, settings, glossaryText: '' }, lines, 50
    );
    assert(ok === 4, `bisection recovered all 4 (ok=${ok})`);
    assert(errors.length === 0, 'no chunk-level errors after bisection');
    assert(tm.total() === 4, 'TM filled via fallback path');
    mgr.flushAll();
  }

  // 4) persistent single-line failure -> surfaces error, TM marks error
  console.log('== hard failure marks error ==');
  {
    const dir = tmpDir();
    const mgr = createTmManager({ dataDir: dir, sourceLang: 'English' });
    const tm = mgr.forGame('Game A');
    // Mock fails at every size when lines contain the word "boom".
    const provider = {
      key: 'deepseek',
      label: 'Mock failing',
      supportsStreaming: true,
      async translateBatch(lines) {
        if (lines.some((l) => l.includes('boom'))) throw new Error('mock always fails');
        return lines.map((l) => `【译】${l}`);
      },
      async translateLine(line) {
        if (line.includes('boom')) throw new Error('mock line fails');
        return `【译】${line}`;
      },
    };
    const lines = ['good line one.', 'boom bad line.'];
    const { ok, errors } = await translateTranscriptInto(
      { provider, tm, settings, glossaryText: '' }, lines, 50
    );
    assert(ok === 1, 'only good line translated');
    assert(errors.length === 1, 'one chunk error surfaced');
    const errEntry = tm.exactLookup('boom bad line.');
    assert(errEntry && errEntry.status === 'error', 'failed line marked error in TM');
    const good = tm.exactLookup('good line one.');
    assert(good && good.status === 'translated', 'good line translated');
    mgr.flushAll();
  }

  // 5) equal-split + concurrency cap
  console.log('== equal split + concurrency ==');
  {
    const { equalSplitSizes } = require('../src/main/translate/batch');
    const sizes = equalSplitSizes(709, 70);
    assert(sizes.length === 10, '709/70 -> 10 segments');
    assert(sizes.every((s) => s >= 70 && s <= 110), 'each segment within [70,110]');
    assert(sizes.reduce((a, b) => a + b, 0) === 709, 'segments sum to total');
    // concurrency cap = 3
    let inFlight = 0, peak = 0;
    const cprovider = {
      key: 'deepseek', label: 'mock', supportsStreaming: true,
      async translateBatch(lines) {
        inFlight++; if (inFlight > peak) peak = inFlight;
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return lines.map((l) => '【译】' + l);
      },
      async translateLine(l) { return '【译】' + l; },
    };
    const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'conc-'));
    const ctm = createTmManager({ dataDir: cdir, sourceLang: 'English' }).forGame('G');
    const csettings = { sourceLang: 'English', targetLang: 'Chinese', tmBatchConcurrency: 3, sources: { deepseek: { model: 'm' } } };
    const clines = [];
    for (let i = 0; i < 500; i++) clines.push(`line ${i}`);
    const cres = await translateTranscriptInto({ provider: cprovider, tm: ctm, settings: csettings }, clines, 70);
    assert(cres.ok === 500, 'all 500 translated');
    assert(cres.totalChunks === 7, '500/70 -> 7 segments');
    assert(peak <= 3, `peak in-flight ${peak} <= concurrency 3`);
  }

  // 6) Live DeepSeek integration (optional)
  if (process.env.OCR_TM_DEEPSEEK_KEY && process.env.OCR_TM_LIVE === '1') {
    console.log('== live DeepSeek integration (optional) ==');
    const dir = tmpDir();
    const mgr = createTmManager({ dataDir: dir, sourceLang: 'English' });
    const tm = mgr.forGame('LiveGame');
    const { createDeepSeekProvider } = require('../src/main/translate/sources/deepseek');
    const bundle = {
      apiKey: process.env.OCR_TM_DEEPSEEK_KEY,
      apiBase: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    };
    const provider = createDeepSeekProvider(bundle, settings);
    const lines = ['Where are you going?', 'To the old castle.', 'I will come with you.'];
    const { ok, errors, results } = await translateTranscriptInto(
      { provider, tm, settings, glossaryText: '' }, lines, 10
    );
    console.log('  live ok=', ok, 'errors=', errors.length, 'results=', results.length);
    for (const r of results) console.log(`  raw: ${r.raw}\n  -> ${r.translated}`);
    assert(ok === 3, 'live DeepSeek translated 3 lines');
    assert(
      results.every((r) => r.translated && r.translated.trim().toLowerCase() !== r.raw.trim().toLowerCase()),
      'live translations are not echoes of the source'
    );
    mgr.flushAll();
  } else {
    console.log('== (skip live DeepSeek; set OCR_TM_DEEPSEEK_KEY + OCR_TM_LIVE=1 to run) ==');
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
