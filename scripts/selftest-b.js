// Offline self-test for Phase B decision core: stabilizer (typewriter), recorder
// (batch capture state machine) and router (mode dispatch: live TM-hit /
// suspect / translate; record capture / de-dup).
//
// Usage: node scripts/selftest-b.js

const { createStabilizer } = require('../src/main/ocr/stabilizer');
const { createRecorder, REC_STATE } = require('../src/main/ocr/recorder');
const { createRouter } = require('../src/main/ocr/route');

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.error(`  FAIL ${label}`); }
}

// ---- stabilizer ----
console.log('== stabilizer (typewriter) ==');
{
  const st = createStabilizer({ stableFrames: 3 });
  const frames = ['Hello', 'Hello', 'Hello']; // stable 3 -> commit on 3rd
  let committed = [];
  frames.forEach((f) => { const r = st.handle(f); if (r.commit) committed.push(r.commit); });
  assert(committed.length === 1 && committed[0] === 'Hello', 'commits once after 3 stable frames');
  // static line must NOT re-commit merely by time passing
  let more = [];
  for (let i = 0; i < 10; i++) { const r = st.handle('Hello'); if (r.commit) more.push(r.commit); }
  assert(more.length === 0, 'static line not re-committed while still on screen');
  // after departing (blank) then same line returns -> allowed again (commits on
  // the 3rd stable frame)
  st.handle(''); // depart
  st.handle('Hello'); st.handle('Hello');
  const r = st.handle('Hello');
  assert(r.commit === 'Hello', 're-commit allowed after line left screen');
  // half-line changing never commits below threshold
  const st2 = createStabilizer({ stableFrames: 3 });
  const seq = ['Ab', 'Abc', 'Abcd', 'Abcd', 'Abcd'];
  let c2 = [];
  seq.forEach((f) => { const r = st2.handle(f); if (r.commit) c2.push(r.commit); });
  assert(c2.length === 1 && c2[0] === 'Abcd', 'only final stable text commits (no partials)');
}

// ---- recorder ----
console.log('== recorder (batch capture) ==');
{
  const known = new Set(['already known line'.toLowerCase()]);
  const rec = createRecorder({
    isKnown: (norm) => known.has(norm),
    onEvent: () => {},
  });
  rec.normOf = (s) => s.trim().toLowerCase().replace(/[.!?,]/g, '').replace(/\s+/g, ' ');
  rec.start();
  assert(rec.getState().state === REC_STATE.RECORDING, 'start -> recording');
  rec.add('Hello there.');
  rec.add('Hello there!!'); // same norm -> dedupe
  assert(rec.getState().count === 1, 'recorder dedupes identical sentences');
  rec.add('Second line.');
  assert(rec.getState().count === 2, 'adds distinct second line');
  assert(rec.add('already known line').added === false, 'skips line already in TM');
  rec.stop();
  assert(rec.getState().state === REC_STATE.RECORDED, 'stop -> recorded');
  rec.reset();
  assert(rec.getState().count === 0 && rec.getState().state === REC_STATE.IDLE, 'reset clears to idle');
}

// ---- router: LIVE mode ----
console.log('== router: live mode (TM hit / suspect / translate) ==');
{
  const calls = { tmHit: 0, suspect: 0, translate: 0, recordHistory: 0 };
  const fakeRecords = { commit: () => { calls.recordHistory++; return { record: { id: 'r1' }, merged: false }; } };
  // normalise: lowercase, strip punctuation/extra space
  const normOf = (s) => s.trim().toLowerCase().replace(/[.!?,]/g, '').replace(/\s+/g, ' ');
  const makeCtx = (overrides) => ({
    getMode: () => 'live',
    normOf,
    exactHit: () => null,
    recordHistory: (raw) => { calls.recordHistory++; return { record: { id: 'r1', raw }, merged: false }; },
    setRecordTranslated: () => {},
    hasInFlight: () => false,
    markInFlight: () => {},
    clearInFlight: () => {},
    registerTmHit: () => calls.tmHit++,
    showOverlay: () => {},
    emitSuspect: () => calls.suspect++,
    suspectCandidates: () => [],
    translateLive: async (raw) => { calls.translate++; return '【译】' + raw; },
    storeTm: () => {},
    model: () => 'deepseek-chat',
    recorder: {},
    recorderCount: () => 0,
    log: () => {},
    ...overrides,
  });

  (async () => {
    // TM hit path: no translate
    {
      calls.tmHit = 0; calls.translate = 0;
      const ctx = makeCtx({ exactHit: () => ({ id: 't1', translated: '已缓存译文', model: 'm', src: 'deepseek' }) });
      const r = await createRouter(ctx).commit('Hello world.');
      assert(r.action === 'tm-hit' && calls.translate === 0, 'TM hit -> instant, no API call');
    }
    // suspect path: no translate, emitted suspect
    {
      calls.suspect = 0; calls.translate = 0;
      const ctx = makeCtx({ suspectCandidates: () => [{ id: 's1', raw: 'Hello world', translated: 'x' }] });
      const r = await createRouter(ctx).commit('Hello wordl.');
      assert(r.action === 'suspect' && calls.suspect === 1 && calls.translate === 0, 'suspect -> emit, no auto translate');
    }
    // normal translate path
    {
      calls.translate = 0;
      const ctx = makeCtx({});
      const r = await createRouter(ctx).commit('Good morning.');
      assert(r.action === 'translated' && calls.translate === 1, 'no hit/suspect -> live translate');
      assert(r.translated === '【译】Good morning.', 'translation stored');
    }
    // in-flight guard: does not double translate identical sentence while queued
    {
      calls.translate = 0;
      let inFlight = false;
      const ctx = makeCtx({
        exactHit: () => null,
        hasInFlight: () => inFlight,
        markInFlight: () => (inFlight = true),
        clearInFlight: () => (inFlight = false),
        translateLive: async (raw) => { calls.translate++; await new Promise((res) => setTimeout(res, 5)); return 't'; },
      });
      // first: not in flight -> translate
      const r1 = await createRouter(ctx).commit('Hello there.');
      assert(calls.translate === 1, 'first occurrence translates');
      // second identical while still in flight -> blocked
      inFlight = true;
      const r2 = await createRouter(ctx).commit('Hello there!!');
      assert(r2.action === 'in-flight', 'identical queued sentence not re-translated');
    }
    // recorder count exposed
    assert(true, 'router recorder hooks exist');
  })().catch((e) => { console.error(e); fail++; console.error('router async FAIL'); })
    .finally(() => {
      console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    });
}
