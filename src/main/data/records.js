// Session history store. Merge rule (user decision): the same sentence within
// the SAME session keeps only ONE row; repeated appearances update lastSeen,
// rawLast and count++, never adding a new row. A new session starts fresh rows.

const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteJson, readJson, ensureDir, safeGameName, createDebouncedWriter } = require('./store');
const { computeNorm } = require('./norm');

function createRecordsStore({ dataDir, gameName, sourceLang }) {
  const file = path.join(dataDir, 'records', `${safeGameName(gameName)}.json`);
  ensureDir(path.dirname(file));
  let list = readJson(file, []);
  const byId = new Map();
  const byNorm = new Map(); // key `${sessionId}::${norm}` -> entry
  for (const e of list) {
    byId.set(e.id, e);
    if (e.sessionId && e.norm) byNorm.set(`${e.sessionId}::${e.norm}`, e);
  }

  const writer = createDebouncedWriter(() => atomicWriteJson(file, list));

  function persist() {
    writer.schedule();
  }

  function normOf(raw) {
    return computeNorm(raw, sourceLang);
  }

  // Commit a seen raw line within a session.
  // - If an entry for (sessionId, norm) exists -> merge (count++, rawLast,
  //   lastSeenAt), return {record, merged:true}.
  // - Else create a new row, return {record, merged:false}.
  function commit({ sessionId, raw, model, src, translated, status }) {
    const now = Date.now();
    const norm = normOf(raw);
    if (!norm) return null;
    const key = `${sessionId}::${norm}`;
    const existing = byNorm.get(key);
    if (existing) {
      existing.rawLast = raw;
      existing.lastSeenAt = now;
      existing.count = (existing.count || 1) + 1;
      if (translated && status === 'translated') {
        existing.translated = translated;
        existing.status = 'translated';
        existing.error = null;
        existing.model = model || existing.model;
        existing.src = src || existing.src;
      }
      byId.set(existing.id, existing);
      persist();
      return { record: { ...existing }, merged: true };
    }
    const entry = {
      id: crypto.randomUUID(),
      game: gameName,
      sessionId,
      norm,
      rawFirst: raw,
      rawLast: raw,
      translated: translated || null,
      model: model || '',
      src: src || '',
      firstSeenAt: now,
      lastSeenAt: now,
      count: 1,
      status: status || 'pending',
      error: null,
      flags: {},
    };
    list.push(entry);
    byId.set(entry.id, entry);
    byNorm.set(key, entry);
    persist();
    return { record: { ...entry }, merged: false };
  }

  // Update fields of an existing record by id (translation completed, etc).
  function update(id, patch) {
    const e = byId.get(id);
    if (!e) return null;
    Object.assign(e, patch);
    persist();
    return { ...e };
  }

  // Apply a translation result to a record row (used after realtime translate).
  function setTranslated(id, { translated, model, src, status, error, revised }) {
    const patch = {
      translated,
      model,
      src,
      status: status || 'translated',
      error: error == null ? null : error,
    };
    // whether this translation was produced/corrected by a forced DeepSeek
    // re-translation (authoritative; used as better [History] for local model).
    // Only set/clear when explicitly provided, so other updates keep the flag.
    if (revised != null) patch.revised = !!revised;
    return update(id, patch);
  }

  function forSession(sessionId) {
    return list
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
      .map((e) => ({ ...e }));
  }

  function latest(count = 200) {
    return [...list]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, count)
      .map((e) => ({ ...e }));
  }

  function get(id) {
    const e = byId.get(id);
    return e ? { ...e } : null;
  }

  function deleteOne(id) {
    const e = byId.get(id);
    if (!e) return false;
    const idx = list.indexOf(e);
    if (idx >= 0) list.splice(idx, 1);
    byId.delete(id);
    byNorm.delete(`${e.sessionId}::${e.norm}`);
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
    commit,
    update,
    setTranslated,
    forSession,
    latest,
    get,
    deleteOne,
    clear,
    total: () => list.length,
    flush: () => writer.flushNow(),
  };
}

module.exports = { createRecordsStore };
