// Settings persistence with per-source bundles. All updates are applied IN PLACE
// to the live settings object so references to nested source objects (captured by
// long-lived translation providers) remain valid across configuration changes.

const path = require('node:path');
const { atomicWriteJson, readJson } = require('./store');
const { DEFAULTS, SOURCES, MODES } = require('../../shared/constants');

const SOURCE_DEFAULTS = {
  [SOURCES.DEEPSEEK]: { apiKey: '', apiBase: 'https://api.deepseek.com', model: 'deepseek-chat', contextWindow: 20 },
  [SOURCES.LMSTUDIO]: { apiKey: 'lm-studio', apiBase: 'http://127.0.0.1:1234/v1', model: 'translat', contextWindow: 8 },
};

const clampInt = (n, min, max, dflt) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt;
};
const clampFloat = (n, min, max, dflt) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
};

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Recursively merge `patch` into `target` (mutates target, keeps nested identity).
function mergeDeep(target, patch) {
  for (const k of Object.keys(patch || {})) {
    const pv = patch[k];
    if (isPlainObject(pv)) {
      if (!isPlainObject(target[k])) target[k] = {};
      mergeDeep(target[k], pv);
    } else {
      target[k] = pv;
    }
  }
  return target;
}

// Sanitise/clamp top-level fields and guarantee source bundles exist, WITHOUT
// replacing existing nested source objects.
function normalizeInPlace(s) {
  // start from defaults so any brand-new key appears
  for (const k of Object.keys(DEFAULTS)) {
    if (s[k] === undefined) s[k] = DEFAULTS[k];
  }
  if (!isPlainObject(s.box)) s.box = { ...DEFAULTS.box };
  else s.box = Object.assign({}, DEFAULTS.box, s.box);
  if (!isPlainObject(s.sources)) s.sources = {};
  for (const k of Object.keys(SOURCE_DEFAULTS)) {
    if (!isPlainObject(s.sources[k])) {
      s.sources[k] = Object.assign({}, SOURCE_DEFAULTS[k]);
    } else {
      // merge defaults into existing object in place (keeps identity), but do not
      // wipe a stored apiKey/base/model that user set
      const d = SOURCE_DEFAULTS[k];
      for (const dk of Object.keys(d)) if (s.sources[k][dk] === undefined) s.sources[k][dk] = d[dk];
    }
  }
  // clamps
  s.ocrIntervalMs = Math.max(200, Number(s.ocrIntervalMs) || 300);
  s.stableFrames = clampInt(s.stableFrames, 2, 10, 3);
  s.tmBatchSize = clampInt(s.tmBatchSize, 70, 110, 70);
  s.tmBatchConcurrency = clampInt(s.tmBatchConcurrency, 1, 8, 3);
  s.tmReasoningEffort = ['off', 'low', 'high'].includes(s.tmReasoningEffort) ? s.tmReasoningEffort : 'off';
  s.tmSimilarityThreshold = clampFloat(s.tmSimilarityThreshold, 0, 1, 0.85);
  s.mode = s.mode === MODES.RECORD ? MODES.RECORD : MODES.LIVE;
  s.translateSource = s.translateSource === SOURCES.LMSTUDIO ? SOURCES.LMSTUDIO : SOURCES.DEEPSEEK;
  s.overlayFontSize = clampInt(s.overlayFontSize, 10, 60, 20);
  s.overlayOriginalFontSize = clampInt(s.overlayOriginalFontSize, 8, 40, 13);
  s.overlayWidth = clampInt(s.overlayWidth, 240, 900, 520);
  s.localContextWindow = clampInt(s.localContextWindow, 1, 60, 20);
  if (s.overlayX != null) s.overlayX = Math.round(Number(s.overlayX) || 0);
  if (s.overlayY != null) s.overlayY = Math.round(Number(s.overlayY) || 0);
  s.listLayout = s.listLayout === 'single' ? 'single' : 'two';
  s.sourceLang = s.sourceLang || 'English';
  s.targetLang = s.targetLang || 'Simplified Chinese';
  s.gameName = s.gameName || 'My Game';
  return s;
}

function createSettingsStore({ file }) {
  // load, deep-merge over defaults, keep the SAME object thereafter.
  const loaded = readJson(file, {});
  const merged = mergeDeep({}, DEFAULTS);
  mergeDeep(merged, loaded);
  normalizeInPlace(merged);
  const settings = merged;
  function save() {
    atomicWriteJson(file, settings);
  }
  save();
  return {
    get() {
      return settings;
    },
    update(patch) {
      mergeDeep(settings, patch || {});
      normalizeInPlace(settings);
      save();
      return settings;
    },
    activeSource() {
      return settings.sources[settings.translateSource] || settings.sources[SOURCES.DEEPSEEK];
    },
    sources() {
      return settings.sources;
    },
  };
}

module.exports = { createSettingsStore, SOURCE_DEFAULTS, normalizeInPlace, mergeDeep };
