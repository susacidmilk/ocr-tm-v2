// Glossary store: a flat list keyed by game name (only the current game's terms
// are applied). Entries: { id, game, source, target, note, enabled }.
// Persisted to a single glossary.json under the data dir.

const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteJson, readJson } = require('./store');

function createGlossaryStore({ file }) {
  let list = readJson(file, []);
  const byId = new Map();
  for (const e of list) byId.set(e.id, e);
  const writer = { schedule() {} };
  // small immediate write helper
  function persist() {
    atomicWriteJson(file, list);
  }
  function forGame(game) {
    return list.filter((e) => e.game === game);
  }
  function enabledFor(game) {
    return forGame(game).filter((e) => e.enabled !== false && e.source && e.target);
  }
  function add({ game, source, target, note, enabled }) {
    const entry = { id: crypto.randomUUID(), game: String(game || ''), source: String(source || '').trim(), target: String(target || '').trim(), note: String(note || '').trim(), enabled: enabled !== false };
    if (!entry.game || !entry.source || !entry.target) return null;
    list.push(entry);
    byId.set(entry.id, entry);
    persist();
    return { ...entry };
  }
  function update(id, patch) {
    const e = byId.get(id);
    if (!e) return null;
    Object.assign(e, patch);
    persist();
    return { ...e };
  }
  function remove(id) {
    const idx = list.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    const [e] = list.splice(idx, 1);
    byId.delete(e.id);
    persist();
    return true;
  }
  function clear(game) {
    const keep = list.filter((e) => e.game !== game);
    list = keep;
    byId.clear();
    for (const e of list) byId.set(e.id, e);
    persist();
  }
  function all() {
    return list.map((e) => ({ ...e }));
  }
  return { forGame, enabledFor, add, update, remove, clear, all };
}

module.exports = { createGlossaryStore };
