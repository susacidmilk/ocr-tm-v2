// Application entry: assemble modules, create windows, wire IPC.
// Phase 2 wiring: data layer + batch translate + OCR controller (live/record)
// + batch-recorder driven translation into TM.

const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const { MODES } = require('../shared/constants');
const Events = require('../shared/events');
const { ensureDir } = require('./data/store');
const { createSettingsStore } = require('./data/settings');
const { createTmManager } = require('./data/tm');
const { createRecordsStore } = require('./data/records');
const { createGlossaryStore } = require('./data/glossary');
const { computeNorm } = require('./data/norm');
const { createDeepSeekProvider } = require('./translate/sources/deepseek');
const { createLmStudioProvider } = require('./translate/sources/lmstudio');
const { translateTranscriptInto } = require('./translate/batch');
const { createOcrEngine } = require('./ocr/capture');
const { createStabilizer } = require('./ocr/stabilizer');
const { createRecorder } = require('./ocr/recorder');
const { createOcrController } = require('./ocr/controller');
const { suspectCandidates } = require('./match/fuzzy');

let mainWindow = null;
let pickerWindow = null;
let overlayWindow = null;
let overlayLoaded = false;
let regionWindow = null;
let regionLoaded = false;
let settingsStore = null;
let tmManager = null;
let glossaryStore = null;
let providerCache = new Map();
let ocrController = null;
let ocrEngine = null;
let recorder = null;
let dataDir = null;

// Per-(game, session) records store cache.
const recordCache = new Map();
function recordsFor(game, sessionId) {
  const key = `${game}::${sessionId}`;
  if (!recordCache.has(key)) {
    recordCache.set(
      key,
      createRecordsStore({ dataDir, gameName: game, sourceLang: settingsStore.get().sourceLang })
    );
  }
  return recordCache.get(key);
}

function broadcast(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:event', payload);
  }
  // Overlay events drive the floating overlay window (lazily created).
  if (payload && payload.type === 'overlay') {
    forwardToOverlay(payload.data);
  }
}

// ---------------------------------------------------------------------------
// Floating overlay window (live translation display)
// ---------------------------------------------------------------------------
const OVERLAY_MAX_W = 900;
let lastOverlayPayload = null;
let lastOverlayPos = null; // {x,y} last place the overlay sat (user drags preserved)

function overlayWidthSetting() {
  const w = Number(settings().overlayWidth);
  return Math.max(240, Math.min(900, w && isFinite(w) ? w : 520));
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  overlayLoaded = false;
  overlayWindow = new BrowserWindow({
    width: overlayWidthSetting(),
    height: 160,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  overlayWindow.webContents.once('did-finish-load', () => {
    overlayLoaded = true;
    applyOverlayLocked();
    // A payload broadcast before the page was ready would be lost; replay it.
    if (lastOverlayPayload) {
      overlayWindow.webContents.send('app:event', { type: 'overlay', data: lastOverlayPayload });
      if (!overlayWindow.isVisible()) overlayWindow.showInactive();
    }
  });
  // remember where the user moves the overlay so later content updates don't
  // shove it back to a default corner
  overlayWindow.on('moved', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      lastOverlayPos = overlayWindow.getPosition();
    }
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    overlayLoaded = false;
  });
  return overlayWindow;
}

function applyOverlayLocked() {
  const s = settings();
  const locked = s.overlayLocked !== false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(locked, { forward: true });
  }
}

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function boxScreenRect(box, d) {
  return { x: d.bounds.x + (Number(box.x) || 0), y: d.bounds.y + (Number(box.y) || 0), width: Number(box.width) || 0, height: Number(box.height) || 0 };
}

// Pick the nearest non-overlapping spot to the current overlay rect around the
// OCR box: try above, below, left, right in turn, return the first fit.
function nearestFreeSpot(cur, boxR, db, w, h) {
  const margin = 16;
  const candidates = [
    { x: boxR.x, y: boxR.y - h - margin }, // above
    { x: boxR.x, y: boxR.y + boxR.height + margin }, // below
    { x: boxR.x - w - margin, y: boxR.y }, // left
    { x: boxR.x + boxR.width + margin, y: boxR.y }, // right
  ];
  const clamp = (p) => ({
    x: Math.max(db.x + 4, Math.min(p.x, db.x + db.width - w - 4)),
    y: Math.max(db.y + 4, Math.min(p.y, db.y + db.height - h - 4)),
  });
  const within = (p) => p.x >= db.x && p.y >= db.y && p.x + w <= db.x + db.width && p.y + h <= db.y + db.height;
  // closest candidate first by Manhattan distance from current position
  candidates.sort((A, B) => Math.abs(A.x - cur.x) + Math.abs(A.y - cur.y) - (Math.abs(B.x - cur.x) + Math.abs(B.y - cur.y)));
  for (const cand of candidates) {
    const p = clamp(cand);
    const r = { x: p.x, y: p.y, width: w, height: h };
    if (!rectsOverlap(r, boxR) && within(p)) return p;
  }
  return clamp(candidates[3]); // right, clamped — best effort
}

// Ensure the overlay is not sitting on the OCR sampling box. If it currently
// overlaps, move it to the nearest free spot. Otherwise leave its position alone
// (so user-dragged placement survives content updates).
function repositionOverlayIfOverlapping() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
  const s = settings();
  const box = s.box || {};
  const d = screen.getPrimaryDisplay();
  const db = d.workArea || d.bounds;
  if (!box.width || !box.height) return;
  const [w, h] = overlayWindow.getSize();
  const [cx, cy] = overlayWindow.getPosition();
  const cur = { x: cx, y: cy, width: w, height: h };
  const boxR = boxScreenRect(box, d);
  if (!rectsOverlap(cur, boxR)) return; // fine where it is
  const spot = nearestFreeSpot(cur, boxR, db, w, h);
  overlayWindow.setPosition(Math.round(spot.x), Math.round(spot.y));
  lastOverlayPos = overlayWindow.getPosition();
}

// Move overlay to the remembered / default position (only when it has no known
// position yet, e.g. first show). Also avoid the capture box.
function placeOverlayInitial() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
  const d = screen.getPrimaryDisplay();
  const db = d.workArea || d.bounds;
  const [w, h] = overlayWindow.getSize();
  let x;
  let y;
  const s = settings();
  if (s.overlayX != null && s.overlayY != null) {
    x = s.overlayX;
    y = s.overlayY;
  } else if (lastOverlayPos) {
    x = lastOverlayPos.x;
    y = lastOverlayPos.y;
  } else {
    x = db.x + db.width - w - 24;
    y = db.y + db.height - h - 48;
  }
  const p = { x: Math.max(db.x + 4, Math.min(Math.round(x), db.x + db.width - w - 4)), y: Math.max(db.y + 4, Math.min(Math.round(y), db.y + db.height - h - 4)) };
  overlayWindow.setPosition(p.x, p.y);
  // persist as user-preferred so next launches reuse it
  if (s.overlayX !== p.x || s.overlayY !== p.y) settingsStore.update({ overlayX: p.x, overlayY: p.y });
  lastOverlayPos = overlayWindow.getPosition();
  repositionOverlayIfOverlapping();
}

function forwardToOverlay(data) {
  if (!data) return;
  const s = settings();
  if (s.showOverlay === false) return;
  const win = ensureOverlayWindow();
  // attach display settings so the overlay renderer needn't re-query IPC
  const payload = {
    ...(data || {}),
    overlayFontSize: s.overlayFontSize,
    overlayOriginalFontSize: s.overlayOriginalFontSize,
  };
  lastOverlayPayload = payload;
  win.webContents.send('app:event', { type: 'overlay', data: payload });
  const wasHidden = !win.isVisible();
  if (wasHidden) {
    placeOverlayInitial();
    win.showInactive();
  } else {
    // keep user position; only nudge away if a resize grew it onto the capture box
    repositionOverlayIfOverlapping();
  }
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
}

function destroyOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
    overlayLoaded = false;
  }
}

// ---------------------------------------------------------------------------
// Persistent faint frame indicating the OCR capture region
// ---------------------------------------------------------------------------
const REGION_MARGIN = 8; // px gutter around the box (line drawn in this gutter)

function ensureRegionWindow() {
  if (regionWindow && !regionWindow.isDestroyed()) return regionWindow;
  regionLoaded = false;
  regionWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  regionWindow.setAlwaysOnTop(true, 'screen-saver');
  regionWindow.setIgnoreMouseEvents(true, { forward: true });
  regionWindow.loadFile(path.join(__dirname, '..', 'renderer', 'regionframe.html'));
  regionWindow.webContents.once('did-finish-load', () => (regionLoaded = true));
  regionWindow.on('closed', () => {
    regionWindow = null;
    regionLoaded = false;
  });
  return regionWindow;
}

// Size/position the frame window over the box (expanded by REGION_MARGIN). Shows
// only when showRegionFrame is on. Outline is drawn in the margin outside the box
// so OCR screen captures are unaffected.
function applyRegionFrame() {
  const s = settings();
  if (s.showRegionFrame === false) {
    if (regionWindow && !regionWindow.isDestroyed()) regionWindow.hide();
    return;
  }
  const box = s.box || {};
  const w = Math.max(1, Number(box.width) || 0);
  const h = Math.max(1, Number(box.height) || 0);
  if (!w || !h) {
    if (regionWindow && !regionWindow.isDestroyed()) regionWindow.hide();
    return;
  }
  const d = screen.getPrimaryDisplay();
  const win = ensureRegionWindow();
  const x = Math.round(d.bounds.x + (Number(box.x) || 0) - REGION_MARGIN);
  const y = Math.round(d.bounds.y + (Number(box.y) || 0) - REGION_MARGIN);
  win.setBounds({ x, y, width: Math.round(w + REGION_MARGIN * 2), height: Math.round(h + REGION_MARGIN * 2) });
  if (!win.isVisible()) win.showInactive();
}

function destroyRegionWindow() {
  if (regionWindow && !regionWindow.isDestroyed()) {
    regionWindow.destroy();
    regionWindow = null;
  }
}

// ---------------------------------------------------------------------------

function resolveDataDir() {
  const dir = path.join(app.getPath('userData'), 'ocr-tm-v2');
  ensureDir(dir);
  return dir;
}

function currentGame() {
  return settingsStore.get().gameName || 'My Game';
}
function currentSession() {
  return settingsStore.get().currentSessionId;
}
function settings() {
  return settingsStore.get();
}
function activeSourceKey() {
  const k = settingsStore.get().translateSource;
  return k === 'lmstudio' ? 'lmstudio' : 'deepseek';
}
function activeProvider() {
  return providerFor(activeSourceKey());
}
// convenience for handlers: current source key + its model
function srcModel() {
  const s = settingsStore.get();
  const b = s.sources[activeSourceKey()];
  return (b && b.model) || '';
}
function providerFor(key) {
  if (providerCache.has(key)) return providerCache.get(key);
  const s = settingsStore.get();
  const bundle = s.sources[key];
  const prov =
    key === 'lmstudio'
      ? createLmStudioProvider(bundle, s)
      : createDeepSeekProvider(bundle, s);
  providerCache.set(key, prov);
  return prov;
}

function log(msg) {
  broadcast({ type: 'log', data: msg });
}

// Enabled glossary terms of a game as "src -> dst #备注" lines (empty if none).
function glossaryTextFor(game) {
  if (!glossaryStore) return '';
  const entries = glossaryStore.enabledFor(game || currentGame());
  if (!entries.length) return '';
  return entries.map((g) => `${g.source} -> ${g.target}${g.note ? ' #' + g.note : ''}`).join('\n');
}

function ensureSession() {
  if (!settings().currentSessionId) {
    settingsStore.update({ currentSessionId: crypto.randomUUID() });
  }
  return settings().currentSessionId;
}

// ---- OCR setup -------------------------------------------------------------

function buildOcrController() {
  ocrEngine = createOcrEngine({ ps1Path: path.join(__dirname, '..', '..', 'ocr-worker.ps1') });

  recorder = createRecorder({
    isKnown: (norm) => {
      const tm = tmManager.forGame(currentGame());
      return tm.findByNorm(norm) != null;
    },
    onEvent: (snap) => broadcast({ type: Events.RECORDER_STATUS, data: snap }),
  });
  // recorder.normOf shared with TM/history norm
  recorder.normOf = (raw) => computeNorm(raw, settings().sourceLang);

  const stabilizer = createStabilizer({ stableFrames: settings().stableFrames });

  ocrController = createOcrController({
    engine: ocrEngine,
    stabilizer,
    tmManager,
    recordsFor: (game, sessionId) => recordsFor(game, sessionId),
    normOf: computeNorm,
    settingsStore,
    providerForKey: providerFor,
    activeSourceKey,
    onBroadcast: broadcast,
    suspectCandidates,
    recorder,
    glossaryTextFor,
    toPhysical(box) {
      const d = screen.getPrimaryDisplay();
      const scale = d.scaleFactor || 1;
      return {
        x: Math.round((d.bounds.x + Number(box.x)) * scale),
        y: Math.round((d.bounds.y + Number(box.y)) * scale),
        width: Math.max(1, Math.round(Number(box.width) * scale)),
        height: Math.max(1, Math.round(Number(box.height) * scale)),
      };
    },
  });

  return ocrController;
}

function flushAll() {
  if (tmManager) tmManager.flushAll();
  for (const r of recordCache.values()) r.flush();
  if (recorder) recorder._flush && recorder._flush();
}

// ---- IPC --------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('settings:get', () => settingsStore.get());
  ipcMain.handle('settings:save', (_e, patch) => {
    const before = settings();
    const updated = settingsStore.update(patch || {});
    // react to overlay visibility / lock toggles and box changes
    if (patch && patch.showOverlay != null && !patch.showOverlay) hideOverlay();
    if (patch && patch.showOverlay != null && patch.showOverlay) applyOverlayLocked();
    if (patch && patch.overlayLocked != null) applyOverlayLocked();
    if (patch && patch.box) repositionOverlayIfOverlapping();
    if (patch && (patch.box || patch.showRegionFrame != null)) applyRegionFrame();
    if (patch && (patch.overlayFontSize != null || patch.overlayOriginalFontSize != null) && lastOverlayPayload) {
      // live-apply new font size to whatever the overlay currently shows
      lastOverlayPayload.overlayFontSize = updated.overlayFontSize;
      lastOverlayPayload.overlayOriginalFontSize = updated.overlayOriginalFontSize;
      if (overlayWindow && !overlayWindow.isDestroyed() && overlayLoaded) {
        overlayWindow.webContents.send('app:event', { type: 'overlay', data: lastOverlayPayload });
        repositionOverlayIfOverlapping();
      }
    }
    if (patch && patch.overlayWidth != null && overlayWindow && !overlayWindow.isDestroyed()) {
      const b = overlayWindow.getBounds();
      const nw = overlayWidthSetting();
      if (nw !== b.width) {
        overlayWindow.setBounds({ x: b.x, y: b.y, width: nw, height: b.height });
        repositionOverlayIfOverlapping();
      }
    }
    if (patch && patch.mode === MODES.RECORD && before.mode !== MODES.RECORD) hideOverlay();
    return updated;
  });
  ipcMain.handle('session:new', () => {
    const id = crypto.randomUUID();
    settingsStore.update({ currentSessionId: id });
    broadcast({ type: Events.SETTINGS_CHANGED, data: settingsStore.get() });
    return { sessionId: id };
  });

  // OCR
  ipcMain.handle('ocr:start', () => {
    ensureSession();
    return ocrController.start();
  });
  ipcMain.handle('ocr:stop', () => ocrController.stop());
  ipcMain.handle('ocr:test', async () => {
    try {
      const s = settings();
      const text = await ocrEngine.capture(buildPhysical(s.box));
      return { text };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  });

  // Region picker (mouse-drag box selection)
  ipcMain.handle('box:pick-start', () => {
    if (pickerWindow && !pickerWindow.isDestroyed()) return;
    const d = screen.getPrimaryDisplay();
    pickerWindow = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    pickerWindow.setAlwaysOnTop(true, 'screen-saver');
    pickerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'picker.html'));
    pickerWindow.on('closed', () => (pickerWindow = null));
  });
  ipcMain.handle('box:pick-result', (_e, rect) => {
    if (!pickerWindow || pickerWindow.isDestroyed()) return settings().box;
    const d = screen.getPrimaryDisplay();
    const min = 20;
    const x = Math.max(0, Math.min(Number(rect && rect.x) || 0, d.bounds.width - min));
    const y = Math.max(0, Math.min(Number(rect && rect.y) || 0, d.bounds.height - min));
    const width = Math.max(min, Math.min(Number(rect && rect.width) || min, d.bounds.width - x));
    const height = Math.max(min, Math.min(Number(rect && rect.height) || min, d.bounds.height - y));
    const box = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    settingsStore.update({ box });
    broadcast({ type: Events.SETTINGS_CHANGED, data: settingsStore.get() });
    log(`📐 识别区域已框选：${box.width}×${box.height} @ (${box.x},${box.y})`);
    applyRegionFrame();
    pickerWindow.close();
    return box;
  });
  ipcMain.handle('box:pick-cancel', () => {
    if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
    return null;
  });

  // Floating overlay IPC
  ipcMain.handle('overlay:autosize', (_e, h) => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return null;
    const b = overlayWindow.getBounds();
    const nh = Math.max(60, Math.min(900, Math.round(Number(h) || b.height)));
    const nw = overlayWidthSetting();
    if (nh !== b.height || nw !== b.width) {
      overlayWindow.setBounds({ x: b.x, y: b.y, width: nw, height: nh });
      repositionOverlayIfOverlapping();
    }
    return nh;
  });
  ipcMain.handle('overlay:set-locked', (_e, locked) => {
    settingsStore.update({ overlayLocked: !!locked });
    applyOverlayLocked();
    return settings().overlayLocked;
  });
  ipcMain.handle('overlay:hide', () => {
    hideOverlay();
    return null;
  });

  // Recorder (batch)
  ipcMain.handle('rec:start', () => recorder.start());
  ipcMain.handle('rec:stop', () => recorder.stop());
  ipcMain.handle('rec:reset', () => recorder.reset());
  ipcMain.handle('rec:list', () => recorder.list());
  ipcMain.handle('rec:remove', (_e, idx) => {
    recorder.removeAt(Number(idx));
    return recorder.list();
  });
  ipcMain.handle('rec:edit', (_e, { idx, raw }) => {
    recorder.editAt(Number(idx), String(raw || '').trim());
    return recorder.list();
  });
  ipcMain.handle('rec:translate', async () => {
    const lines = recorder.list();
    if (!lines.length) return { ok: 0, error: '录制清单为空' };
    recorder.markTranslating();
    const s = settings();
    const tm = tmManager.forGame(currentGame());
    // Whole-segment batch translation is ALWAYS forced to remote DeepSeek.
    const provider = providerFor('deepseek');
    const onProgress = (info) =>
      broadcast({ type: Events.BATCH_PROGRESS, data: { ...info, game: currentGame() } });
    try {
      const res = await translateTranscriptInto(
        { provider, tm, settings: s, onProgress, glossaryText: glossaryTextFor(currentGame()) },
        lines,
        s.tmBatchSize || 50
      );
      recorder.markDone();
      broadcast({ type: Events.BATCH_DONE, data: { ...res, game: currentGame() } });
      return { ...res, game: currentGame() };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      broadcast({ type: Events.BATCH_DONE, data: { error: msg } });
      return { error: msg };
    }
  });

  // Match resolve (suspect hit): user confirms "adopt" (use the similar cached
  // translation as this line's own) or "ignore" (translate live instead).
  ipcMain.handle('match:adopt', async (_e, { raw, candidate }) => {
    const text = String(raw || '').trim();
    const cand = candidate || {};
    const translated = String(cand.translated || '').trim();
    if (!text || !translated) return { error: '缺少原文或候选译文' };
    const src = activeSourceKey();
    const model = cand.model || srcModel();
    // store the adopted translation as this line's own TM entry
    tmManager.forGame(currentGame()).upsert({
      raw: text,
      translated,
      model,
      src: cand.src || src,
      status: 'translated',
    });
    // also land in session history
    const rec = recordsFor(currentGame(), currentSession());
    const { record } = rec.commit({
      sessionId: currentSession(),
      raw: text,
      model,
      src: cand.src || src,
      translated,
      status: 'translated',
    });
    rec.setTranslated(record.id, { translated, status: 'translated', model, src: cand.src || src, error: null });
    broadcast({ type: Events.HISTORY_UPDATED, data: { kind: 'adopted', id: record.id } });
    broadcast({ type: Events.TM_UPDATED, data: {} });
    // do NOT force the overlay: this decision came from a history-side review.
    log(`✔ 采用疑似命中译文：${text.slice(0, 40)}`);
    return { ok: true };
  });
  ipcMain.handle('match:ignore', async (_e, { raw }) => {
    const text = String(raw || '').trim();
    if (!text) return { error: '缺少原文' };
    const src = activeSourceKey();
    const provider = providerFor(src);
    const model = srcModel();
    try {
      const t = await provider.translateLine(text, {});
      const translated = String(t || '').trim();
      if (!translated) throw new Error('翻译返回为空');
      tmManager.forGame(currentGame()).upsert({ raw: text, translated, model, src, status: 'translated' });
      const rec = recordsFor(currentGame(), currentSession());
      const { record } = rec.commit({ sessionId: currentSession(), raw: text, model, src, translated, status: 'translated' });
      rec.setTranslated(record.id, { translated, status: 'translated', model, src, error: null });
      broadcast({ type: Events.HISTORY_UPDATED, data: { kind: 'ignored-then-translated', id: record.id } });
      broadcast({ type: Events.TM_UPDATED, data: {} });
      log(`🌐 已忽略疑似命中，实时翻译：${text.slice(0, 40)}`);
      return { ok: true, translated };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      return { error: msg };
    }
  });

  // History
  ipcMain.handle('history:list', (_e, sessionId) => {
    const sid = sessionId || currentSession();
    const rec = recordsFor(currentGame(), sid);
    return rec.forSession(sid);
  });
  ipcMain.handle('history:clear', () => {
    const rec = recordsFor(currentGame(), currentSession());
    rec.clear();
    broadcast({ type: Events.HISTORY_UPDATED, data: { kind: 'cleared' } });
    return { ok: true };
  });
  // Delete one history row.
  ipcMain.handle('history:delete-one', (_e, id) => {
    const rec = recordsFor(currentGame(), currentSession());
    const ok = rec.deleteOne(id);
    broadcast({ type: Events.HISTORY_UPDATED, data: { kind: 'deleted', id } });
    return { ok };
  });
  // Retranslate ONE history row with the ACTIVE source. Refreshes that row + the
  // TM, but NEVER pushes to the floating overlay (user reads it in the history).
  ipcMain.handle('history:retranslate', async (_e, id) => {
    const rec = recordsFor(currentGame(), currentSession());
    const row = rec.get(id);
    if (!row) return { error: '记录不存在' };
    const raw = row.rawLast || row.rawFirst;
    if (!raw) return { error: '记录没有原文' };
    // Re-translate a single line is ALWAYS forced to remote DeepSeek for quality
    // (independent of the currently selected source, which may be local LM Studio).
    const src = 'deepseek';
    const provider = providerFor('deepseek');
    const model = (settings().sources.deepseek && settings().sources.deepseek.model) || 'deepseek-chat';
    rec.setTranslated(id, { translated: null, status: 'translating', error: null });
    broadcast({ type: Events.HISTORY_UPDATED, data: { kind: 'translating', id } });
    log(`↻ 重新翻译（强制 DeepSeek）：${raw.slice(0, 40)}`);
    try {
      const text = await provider.translateLine(raw, { glossaryText: glossaryTextFor(currentGame()) });
      const translated = String(text || '').trim();
      if (!translated) throw new Error('翻译返回为空');
      rec.setTranslated(id, { translated, status: 'translated', model, src, error: null, revised: true });
      // refresh TM cache too so future live hits use the new translation
      tmManager.forGame(currentGame()).upsert({
        raw,
        translated,
        model,
        src,
        status: 'translated',
        meta: { revised: true },
      });
      broadcast({ type: Events.HISTORY_UPDATED, data: { kind: 'retranslated', id, translated } });
      broadcast({ type: Events.TM_UPDATED, data: {} });
      return { ok: true, translated };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      rec.setTranslated(id, { status: 'error', error: msg });
      broadcast({ type: Events.HISTORY_UPDATED, data: { kind: 'error', id, error: msg } });
      return { error: msg };
    }
  });

  // TM
  ipcMain.handle('tm:summary', (_e, game) => {
    const g = tmManager.forGame(game || currentGame());
    return { total: g.total(), snapshot: g.snapshot() };
  });
  ipcMain.handle('tm:search', (_e, { game, q }) => tmManager.forGame(game || currentGame()).search(q));
  ipcMain.handle('tm:clear', (_e, game) => {
    tmManager.forGame(game || currentGame()).clear();
    broadcast({ type: Events.TM_UPDATED, data: {} });
    return { ok: true };
  });
  ipcMain.handle('tm:delete-one', (_e, { game, id }) => {
    const ok = tmManager.forGame(game || currentGame()).deleteOne(id);
    broadcast({ type: Events.TM_UPDATED, data: {} });
    return { ok };
  });
  // Export TM to a JSON/TXT file chosen by the user.
  ipcMain.handle('tm:export', async (_e, { game, format }) => {
    const g = tmManager.forGame(game || currentGame());
    const entries = g.snapshot().filter((e) => e.status === 'translated' && e.translated);
    const fmt = format === 'txt' ? 'txt' : 'json';
    const safe = String(game || currentGame()).replace(/[\\/:*?"<>|]/g, '_') || 'game';
    const defaultPath = path.join(app.getPath('downloads'), `tm-${safe}.${fmt}`);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `导出翻译记忆库（${fmt.toUpperCase()}）`,
      defaultPath,
      filters:
        fmt === 'txt'
          ? [{ name: '文本', extensions: ['txt'] }]
          : [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    let content = '';
    if (fmt === 'json') {
      content = JSON.stringify(entries, null, 2);
    } else {
      content = entries.map((e) => `${e.raw}\t${e.translated}`).join('\n');
    }
    fs.writeFileSync(filePath, content, 'utf8');
    log(`💾 已导出 ${entries.length} 条到 ${filePath}`);
    return { canceled: false, count: entries.length, filePath };
  });
  ipcMain.handle('tm:translate-list', async (_e, opts) => {
    const s = settingsStore.get();
    const game = (opts && opts.game) || currentGame();
    const lines = (opts && opts.lines) || [];
    const tm = tmManager.forGame(game);
    // Batch translation is ALWAYS forced to remote DeepSeek.
    const provider = providerFor('deepseek');
    const onProgress = (info) => broadcast({ type: Events.BATCH_PROGRESS, data: { ...info, game } });
    const res = await translateTranscriptInto(
      { provider, tm, settings: s, onProgress, glossaryText: glossaryTextFor(game) },
      lines,
      s.tmBatchSize || 50
    );
    return { ...res, game, total: tm.total() };
  });

  // Glossary (per current game)
  ipcMain.handle('glossary:list', (_e, game) => glossaryStore.forGame(game || currentGame()));
  ipcMain.handle('glossary:add', (_e, { game, source, target, note }) => {
    const e = glossaryStore.add({ game: game || currentGame(), source, target, note });
    return e;
  });
  ipcMain.handle('glossary:toggle', (_e, { id, enabled }) => {
    const e = glossaryStore.update(id, { enabled: !!enabled });
    broadcast({ type: Events.TM_UPDATED, data: {} });
    return e;
  });
  ipcMain.handle('glossary:delete', (_e, id) => {
    const ok = glossaryStore.remove(id);
    return { ok };
  });
}

function buildPhysical(box) {
  const d = screen.getPrimaryDisplay();
  const scale = d.scaleFactor || 1;
  return {
    x: Math.round((d.bounds.x + Number(box.x)) * scale),
    y: Math.round((d.bounds.y + Number(box.y)) * scale),
    width: Math.max(1, Math.round(Number(box.width) * scale)),
    height: Math.max(1, Math.round(Number(box.height) * scale)),
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'OCR 翻译记忆库 v2',
    backgroundColor: '#10131a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
    // When the main window closes, tear down helper windows so the whole app
    // (incl. the floating overlay) exits instead of lingering.
    destroyOverlayWindow();
    destroyRegionWindow();
    if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.destroy();
    pickerWindow = null;
  });
  if (process.env.OCR_TM_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(() => app.quit(), 800));
  }
}

app.whenReady().then(() => {
  dataDir = resolveDataDir();
  settingsStore = createSettingsStore({ file: path.join(dataDir, 'settings.json') });
  tmManager = createTmManager({ dataDir, sourceLang: settings().sourceLang });
  glossaryStore = createGlossaryStore({ file: path.join(dataDir, 'glossary.json') });
  ensureSession();
  buildOcrController();
  registerIpc();
  createMainWindow();
  applyRegionFrame();
});

app.on('window-all-closed', () => {
  flushAll();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  flushAll();
  destroyOverlayWindow();
  destroyRegionWindow();
});
