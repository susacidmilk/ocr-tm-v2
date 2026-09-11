// Shared constants used by both main and renderer.

const MODES = Object.freeze({
  LIVE: 'live', // real-time per-line translation
  RECORD: 'record', // batch-record dialogue (translate later)
});

// Translation "provider" source keys.
const SOURCES = Object.freeze({
  DEEPSEEK: 'deepseek',
  LMSTUDIO: 'lmstudio',
});

const RECORD_STATUS = Object.freeze({
  PENDING: 'pending', // waiting to be translated
  TRANSLATING: 'translating',
  TRANSLATED: 'translated',
  ERROR: 'error',
});

// Defaults (mirrored by settings persistence; keep in one place).
const DEFAULTS = Object.freeze({
  mode: MODES.LIVE,
  translateSource: SOURCES.DEEPSEEK, // which translation provider is active
  gameName: 'My Game',
  sourceLang: 'English',
  targetLang: 'Simplified Chinese',
  box: { x: 100, y: 100, width: 500, height: 120 },
  ocrIntervalMs: 300,
  stableFrames: 3,
  showOverlay: true,
  overlayLocked: true,
  overlayFontSize: 20,
  overlayOriginalFontSize: 13,
  overlayWidth: 520, // overlay window width (px)
  overlayRevealDelayMs: 700,
  // remembered overlay position (null = auto)
  overlayX: null,
  overlayY: null,
  // glossary
  glossaryText: '', // optional extra glossary provided by user
  // local(LM Studio) prompt: max [History] lines to send as context
  localContextWindow: 20,
  // persistent faint frame showing the OCR capture region
  showRegionFrame: true,
  // history/TM list entry layout: 'single' (one row, translation truncated) | 'two' (two full rows)
  listLayout: 'two',
  // batch / TM
  tmBatchSize: 70, // target lines per batch request (auto-equal split 70..110)
  tmBatchConcurrency: 3, // how many batch chunks may be in flight at once
  tmReasoningEffort: 'low', // request body reasoning_effort: 'off' | 'low' | 'high'
  tmBatchTemperature: 0, // deterministic batch translation (low = reliable)
  tmSimilarityThreshold: 0.85, // fuzzy-hit similarity (0-1)
  tmAutoRetry: true,
});

module.exports = { MODES, SOURCES, RECORD_STATUS, DEFAULTS };
