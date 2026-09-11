// Generic persistence helpers. Pure Node (no electron dependency) so it can run
// under plain `node` for self-tests. The base data dir is supplied by the caller
// (electron main passes app.getPath('userData'); scripts pass a temp dir).

const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Atomic write: write to `<file>.tmp` then rename over `<file>`.
function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Map a user-facing game name to a filesystem-safe id.
function safeGameName(name) {
  const s = String(name == null ? '' : name).trim() || 'My Game';
  return (
    s
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'My_Game'
  );
}

// Collects dirty-triggered writes so many rapid changes flush as one disk write.
function createDebouncedWriter(fn, delayMs = 250) {
  let timer = null;
  let pending = false;
  const run = () => {
    timer = null;
    pending = false;
    try {
      fn();
    } catch (e) {
      // surface async write errors so callers can handle
      if (createDebouncedWriter._onError) createDebouncedWriter._onError(e);
    }
  };
  return {
    schedule() {
      pending = true;
      if (timer) return;
      timer = setTimeout(run, delayMs);
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending) run();
    },
  };
}
createDebouncedWriter._onError = null;

module.exports = {
  ensureDir,
  atomicWriteJson,
  readJson,
  safeGameName,
  createDebouncedWriter,
};
