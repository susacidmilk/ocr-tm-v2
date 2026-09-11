// Self-test for the visual-novel local prompt builder + glossary store.
// Usage: node scripts/selftest-c.js

const { buildVnMessages } = require('../src/main/translate/vnprompt');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createGlossaryStore } = require('../src/main/data/glossary');

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.error('  FAIL ' + label); }
}

console.log('== buildVnMessages ==');
{
  const m = buildVnMessages('Hello there.', {
    sourceLang: 'English',
    targetLang: 'Simplified Chinese',
    glossaryText: '一誠 -> 一诚 #主角',
    history: [{ raw: 'Where are we going?', translated: '我们去哪？', revised: true }, { raw: 'To the castle.', translated: '去城堡。' }],
  });
  assert(!!m.system && !!m.user, 'returns system+user');
  assert(m.system.toLowerCase().includes('simplified chinese'), 'system mentions target lang');
  assert(m.user.includes('[Glossary]') && m.user.includes('一誠 -> 一诚 #主角'), 'glossary block present with format');
  assert(m.user.includes('[History]') && m.user.includes('Where are we going?') && m.user.includes('我们去哪？'), 'history block present');
  assert(m.user.includes('去城堡。'), 'history second line present');
  assert(m.user.includes('[corrected]'), 'revised history line is marked [corrected]');
  assert(m.user.includes('[Input]') && m.user.includes('Hello there.'), 'input present');
  assert(m.user.indexOf('[Input]') > m.user.indexOf('[Glossary]'), 'order: glossary before input');
}

console.log('== buildVnMessages empty glossary/history ==');
{
  const m = buildVnMessages('Hi.', { sourceLang: 'English', targetLang: 'Chinese', glossaryText: '', history: [] });
  assert(!m.user.includes('[History]'), 'no [History] when empty');
  assert(m.user.includes('(none)') || m.user.includes('[Glossary]'), 'glossary shown as none when empty');
}

console.log('== glossary store ==');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glos-'));
  const store = createGlossaryStore({ file: path.join(dir, 'glossary.json') });
  store.add({ game: 'Game A', source: '一誠', target: '一诚', note: '主角' });
  store.add({ game: 'Game A', source: '柑奈', target: '柑奈', note: '女角色' });
  store.add({ game: 'Game B', source: 'X', target: 'Y' });
  store.add({ game: 'Game A', source: 'disabled', target: 'D', note: '', enabled: false });
  assert(store.forGame('Game A').length === 3, 'list per game');
  assert(store.enabledFor('Game A').length === 2, 'enabledFor filters disabled');
  assert(store.enabledFor('Game B').length === 1, 'per-game isolation');
  // delete
  const first = store.forGame('Game A')[0];
  store.remove(first.id);
  assert(store.forGame('Game A').length === 2, 'remove works');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
