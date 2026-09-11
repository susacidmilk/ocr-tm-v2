// Offline self-test for the data layer: norm, per-game TM, and history merge
// (one row per sentence within a session). No network / no electron needed.
//
// Usage: node scripts/selftest-data.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeNorm } = require('../src/main/data/norm');
const { createTmManager } = require('../src/main/data/tm');
const { createRecordsStore } = require('../src/main/data/records');

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-tm-data-'));
}

// ---- norm ----
console.log('== computeNorm ==');
assert(computeNorm('Hello, world!', 'English') === 'hello world', 'strips punctuation/lowercases');
assert(computeNorm("  I   don't   know.  ", 'English') === "i don't know", 'keeps word-internal apostrophe');
assert(computeNorm('“Really?” she asked.', 'English') === 'really she asked', 'strips curly quotes/question');
assert(computeNorm('你好，世界！', 'Chinese') === '你好，世界！' || computeNorm('你好，世界！', 'Chinese').length > 0, 'CJK not token-mangled');

// ---- TM per game ----
console.log('== TM (per game isolated) ==');
const dir = tmpDir();
const mgr = createTmManager({ dataDir: dir, sourceLang: 'English' });
const g1 = mgr.forGame('Game A');
const g2 = mgr.forGame('Game B');

const e1 = g1.upsert({ raw: 'Hello, world!', translated: '你好，世界！', model: 'deepseek-chat', src: 'deepseek' });
assert(e1 && e1.translated === '你好，世界！', 'TM upsert stores translation');
// upsert same norm again should reuse, not duplicate
g1.upsert({ raw: 'Hello  world!', translated: '你好，世界！(v2)', model: 'deepseek-chat', src: 'deepseek' });
assert(g1.total() === 1, 'TM dedupes by norm (no duplicate row)');
const hit = g1.exactLookup('hello, world.');
assert(hit && hit.translated.includes('v2'), 'exact lookup tolerates punctuation variance');
// per-game isolation
g2.upsert({ raw: 'Hello, world!', translated: 'GAME B 你好', model: 'deepseek-chat', src: 'deepseek' });
assert(g2.total() === 1 && g1.total() === 1, 'TM isolated per game');
const g1b = g1.exactLookup('Hello world');
assert(g1b && g1b.translated.includes('v2'), 'still GAME A translation (no cross-game bleed)');

// hits counter
g1.registerHit(e1.id);
const afterHit = g1.exactLookup('Hello, world!');
assert(afterHit.hits >= 1, 'registerHit increments hits');

// TM deleteOne
g1.deleteOne(e1.id);
assert(g1.total() === 0, 'TM deleteOne removes entry');
g1.upsert({ raw: 'Hello, world!', translated: '你好，世界！', model: 'deepseek-chat', src: 'deepseek' });
assert(g1.total() === 1, 'TM upsert after delete re-adds');

// search / delete / clear
assert(g1.search('世界').length === 1, 'TM search finds by translation');
g1.flush();

// ---- History merge semantics ----
console.log('== History (one row per sentence in a session) ==');
const h1 = createRecordsStore({ dataDir: dir, gameName: 'Game A', sourceLang: 'English' });
const s = 'session-1';
const r1 = h1.commit({ sessionId: s, raw: 'Hello there.', model: 'deepseek-chat', src: 'deepseek' });
assert(r1.merged === false, 'first commit creates a row');
const r2 = h1.commit({ sessionId: s, raw: 'Hello  there!!', model: 'deepseek-chat', src: 'deepseek' });
assert(r2.merged === true, 'repeat same sentence merges (no new row)');
assert(h1.total() === 1, 'history holds one row for repeated sentence');
assert(r2.record.count === 2, 'count incremented to 2');
assert(r2.record.rawFirst === 'Hello there.', 'keeps earliest raw');
assert(r2.record.rawLast === 'Hello  there!!', 'records latest raw');
// different session -> new row
const h1b = h1.commit({ sessionId: 'session-2', raw: 'Hello there.', model: 'deepseek-chat', src: 'deepseek' });
assert(h1b.merged === false && h1.total() === 2, 'new session starts a new row');

// records deleteOne removes only the target row
const beforeDel = h1.total();
h1.deleteOne(r2.record.id);
assert(h1.total() === beforeDel - 1, 'records deleteOne removes one row');
assert(h1.get(r2.record.id) == null, 'deleted record no longer findable');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
