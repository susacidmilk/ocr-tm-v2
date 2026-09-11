// OcrController: binds the capture engine, stabilizer, router, stores and the
// batch recorder, and provides the router ctx. No electron types — injected deps.

const { createRouter } = require('./route');
const { MODES } = require('../../shared/constants');

function createOcrController(deps) {
  const {
    engine, // ocr capture engine
    stabilizer,
    tmManager, // per-game TM
    recordsFor, // (gameName, sessionId) -> records store or null (history off for record mode)
    normOf, // (raw, lang) -> norm
    settingsStore,
    providerForKey, // (sourceKey) -> provider instance
    activeSourceKey, // () -> 'deepseek' | 'lmstudio'
    onBroadcast,
    suspectCandidates,
    recorder, // batch recorder
    glossaryTextFor, // (game) -> string; enabled glossary of current game
  } = deps;

  let running = false;
  let busy = false;
  let timer = null;
  const inFlight = new Set();
  let lastRaw = '';
  let garbledFrames = 0;

  function settings() {
    return settingsStore.get();
  }
  function game() {
    return settings().gameName || 'My Game';
  }
  function session() {
    return settings().currentSessionId || 'none';
  }
  function sourceLang() {
    return settings().sourceLang || 'English';
  }
  function targetLang() {
    return settings().targetLang || 'Simplified Chinese';
  }
  function tm() {
    return tmManager.forGame(game());
  }
  function norm(raw) {
    return normOf(raw, sourceLang());
  }
  function records() {
    return recordsFor(game(), session());
  }
  function sourceKey() {
    return activeSourceKey ? activeSourceKey() : settings().translateSource;
  }
  function provider() {
    return providerForKey ? providerForKey(sourceKey()) : null;
  }
  // Recent already-translated lines of this session, oldest first, capped. Used as
  // [History] context for local single-line translation.
  function recentHistory(max) {
    const cap = Math.max(1, Number(max) || settings().localContextWindow || 20);
    const rec = records();
    if (!rec) return [];
    return rec
      .forSession(session())
      .filter((r) => r.raw && r.translated && r.status === 'translated')
      .slice(-cap)
      .map((r) => ({
        raw: r.rawLast || r.rawFirst,
        translated: r.translated,
        revised: !!r.revised, // corrected by forced-DeepSeek re-translate (authoritative)
      }));
  }
  function glossaryText() {
    return glossaryTextFor ? glossaryTextFor(game()) : '';
  }

  function log(msg) {
    onBroadcast && onBroadcast({ type: 'log', data: msg });
  }

  function status(snapshot) {
    onBroadcast && onBroadcast({ type: 'recorder:status', data: snapshot });
  }

  const ctx = {
    getMode: () => settings().mode,
    normOf: norm,
    exactHit: (raw) => {
      const e = tm().exactLookup(raw);
      return e && e.status === 'translated' && e.translated ? e : null;
    },
    recordHistory: (raw) => {
      const rec = records();
      if (!rec) return null;
      const k = sourceKey();
      const s = settings();
      const out = rec.commit({
        sessionId: session(),
        raw,
        model: s.sources[k] ? s.sources[k].model : '',
        src: k,
      });
      // live OCR wrote a history line -> tell the UI to refresh
      if (out) onBroadcast && onBroadcast({ type: 'history:updated', data: { kind: out.merged ? 'merged' : 'added', record: out.record } });
      return out;
    },
    setRecordTranslated: (id, patch) => {
      const rec = records();
      if (!rec) return null;
      const updated = rec.setTranslated(id, patch);
      if (updated) onBroadcast && onBroadcast({ type: 'history:updated', data: { kind: 'updated', record: updated } });
      return updated;
    },
    hasInFlight: (n) => inFlight.has(n),
    markInFlight: (n) => inFlight.add(n),
    clearInFlight: (n) => inFlight.delete(n),
    translateLive: (raw, onPartial) => {
      const p = provider();
      // Local providers consume glossary + recent history as context; remote
      // providers ignore unknown opts gracefully.
      return p.translateLine(raw, {
        onPartial,
        sourceLang: sourceLang(),
        targetLang: targetLang(),
        glossaryText: glossaryText(),
        history: recentHistory(),
      });
    },
    showOverlay: (data) => onBroadcast && onBroadcast({ type: 'overlay', data }),
    emitSuspect: (raw, candidates) => onBroadcast && onBroadcast({ type: 'match:suspect', data: { raw, candidates } }),
    suspectCandidates: (raw) => (suspectCandidates ? suspectCandidates(tm(), raw, settings().tmSimilarityThreshold) : []),
    registerTmHit: (id) => tm().registerHit(id),
    storeTm: (raw, translated, model, src) =>
      tm().upsert({ raw, translated, model, src: src || sourceKey(), status: 'translated' }),
    source: sourceKey,
    model: () => {
      const s = settings();
      const k = sourceKey();
      return s.sources[k] ? s.sources[k].model : '';
    },
    recorder,
    recorderCount: () => recorder.getState().count,
    log,
  };

  const router = createRouter(ctx);

  // isGarbled: minimal heuristic (replacement chars / wrong-language heavy)
  function isGarbled(text) {
    if (!text) return false;
    if (text.includes('\uFFFD')) return true;
    const chars = [...String(text).replace(/\s/g, '')];
    const len = chars.length;
    if (!len) return false;
    const src = sourceLang().toLowerCase();
    const wantsEnglish = !/zh|中文|ja|japanese|ko|korean|chinese/.test(src);
    if (wantsEnglish && len >= 4) {
      const cjk = chars.filter((c) => /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(c)).length;
      if (cjk / len > 0.3) return true;
    }
    return false;
  }

  async function pollOnce() {
    if (!running || busy) return;
    busy = true;
    try {
      const s = settings();
      if (!s.box || !s.box.width || !s.box.height) {
        onBroadcast && onBroadcast({ type: 'log', data: '请先选择识别区域' });
        return;
      }
      // deps.toPhysical (electron) converts CSS coords -> physical pixels for OCR.
      const physical = deps.toPhysical ? deps.toPhysical(s.box) : s.box;
      const text = await engine.capture(physical);
      if (!running) return;
      lastRaw = text;
      onBroadcast && onBroadcast({ type: 'ocr:progress', data: { running: true, raw: text, at: Date.now() } });
      if (isGarbled(text)) {
        garbledFrames += 1;
        onBroadcast && onBroadcast({ type: 'log', data: '⚠️ 识别乱码…' });
        if (garbledFrames >= 5) stop('识别到乱码，已自动停止');
        return;
      }
      garbledFrames = 0;
      const { commit } = stabilizer.handle(text);
      if (commit) await router.commit(commit);
    } catch (err) {
      const m = err && err.message ? err.message : String(err);
      onBroadcast && onBroadcast({ type: 'log', data: `OCR: ${m}` });
    } finally {
      busy = false;
    }
  }

  function start() {
    if (running) return { running: true };
    running = true;
    garbledFrames = 0;
    // In RECORD mode, starting OCR also starts the batch recorder (挂机收集).
    if (settings().mode === MODES.RECORD && recorder) recorder.start();
    const iv = Math.max(200, settings().ocrIntervalMs || 300);
    timer = setInterval(() => pollOnce(), iv);
    pollOnce();
    onBroadcast && onBroadcast({ type: 'ocr:status', data: { running: true } });
    return { running: true };
  }

  function stop(reason = '') {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    running = false;
    garbledFrames = 0;
    // In RECORD mode, stopping OCR freezes the batch (stop collecting -> ready).
    if (settings().mode === MODES.RECORD && recorder) recorder.stop();
    if (reason) stabilizer.reset();
    onBroadcast && onBroadcast({ type: 'ocr:status', data: { running: false, reason } });
    return { running: false };
  }

  return {
    start,
    stop,
    pollOnce,
    isGarbled,
    get mode() {
      return settings().mode;
    },
    _router: router,
    _ctx: ctx,
  };
}

module.exports = { createOcrController };
