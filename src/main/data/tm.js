// Translation Memory (TM): one store instance per game. In-memory Map indexed by
// normalized text (norm) for O(1) lookups, backed by a single JSON file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteJson, readJson, ensureDir, safeGameName, createDebouncedWriter } = require('./store');
const { computeNorm } = require('./norm');

function createTmStore({ dataDir, gameName, sourceLang }) {
  const file = path.join(dataDir, 'tms', `${safeGameName(gameName)}.json`);
  ensureDir(path.dirname(file));

  // entry list kept in insertion order for display/export
  let list = readJson(file, []);
  const byId = new Map();
  const byNorm = new Map();
  for (const e of list) {
    byId.set(e.id, e);
    if (e.norm) byNorm.set(e.norm, e);
  }

  const writer = createDebouncedWriter(() => {
    atomicWriteJson(file, list);
  });

  function persist() {
    writer.schedule();
  }

  function snapshot() {
    return list.map((e) => ({ ...e }));
  }

  function total() {
    return list.length;
  }

  function normOf(raw) {
    return computeNorm(raw, sourceLang);
  }

  function upsert({ id, raw, translated, model, src, meta, status, error, addedAt }) {
    const norm = normOf(raw);
    if (!norm) return null;
    const now = Date.now();
    const existing = byNorm.get(norm);
    let entry;
    if (existing) {
      entry = existing;
      // do not overwrite a good translation with an error/empty
      const newOk = translated && status !== 'error';
      if (newOk || !entry.translated) {
        if (newOk) {
          entry.translated = translated;
          entry.status = status || 'translated';
          entry.error = error == null ? null : error;
        }
        entry.raw = raw;
        entry.model = model || entry.model;
        entry.src = src || entry.src;
        entry.updatedAt = now;
      }
      if (meta) entry.meta = meta;
    } else {
      entry = {
        id: id || crypto.randomUUID(),
        game: gameName,
        raw,
        norm,
        translated: translated || null,
        model: model || '',
        src: src || '',
        addedAt: addedAt || now,
        updatedAt: now,
        hits: 0,
        status: status || (translated ? 'translated' : 'pending'),
        error: error == null ? null : error,
        meta: meta || null,
      };
      list.push(entry);
      byNorm.set(norm, entry);
    }
    byId.set(entry.id, entry);
    persist();
    return { ...entry };
  }

  // Record a live hit. Returns updated copy.
  function registerHit(id) {
    const e = byId.get(id);
    if (!e) return null;
    e.hits = (e.hits || 0) + 1;
    persist();
    return { ...e };
  }

  function exactLookup(raw) {
    const norm = normOf(raw);
    if (!norm) return null;
    const e = byNorm.get(norm);
    if (!e) return null;
    return { ...e };
  }

  function findByNorm(norm) {
    const e = byNorm.get(norm);
    return e ? { ...e } : null;
  }

  function get(id) {
    const e = byId.get(id);
    return e ? { ...e } : null;
  }

  function search(q) {
    if (!q) return snapshot();
    const needle = String(q).trim().toLowerCase();
    if (!needle) return snapshot();
    return list
      .filter((e) =>
        (e.raw || '').toLowerCase().includes(needle) ||
        (e.translated || '').toLowerCase().includes(needle)
      )
      .map((e) => ({ ...e }));
  }

  function allByNorm() {
    const m = new Map();
    for (const e of list) m.set(e.norm, { ...e });
    return m;
  }

  function deleteOne(id) {
    const idx = list.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    const [e] = list.splice(idx, 1);
    byId.delete(e.id);
    byNorm.delete(e.norm);
    persist();
    return true;
  }

  function clear() {
    list = [];
    byId.clear();
    byNorm.clear();
    persist();
  }

  return {
    gameName,
    file,
    snapshot,
    total,
    normOf,
    upsert,
    registerHit,
    exactLookup,
    findByNorm,
    get,
    search,
    allByNorm,
    deleteOne,
    clear,
    flush: () => writer.flushNow(),
  };
}

// Manager that caches one TmStore per game name.
function createTmManager({ dataDir, sourceLang }) {
  const caches = new Map();
  return {
    forGame(gameName) {
      const key = safeGameName(gameName);
      if (!caches.has(key)) {
        caches.set(key, createTmStore({ dataDir, gameName, sourceLang }));
      }
      return caches.get(key);
    },
    flushAll() {
      for (const s of caches.values()) s.flush();
    },
  };
}

module.exports = { createTmStore, createTmManager };
