// Event type constants shared between main and renderer (avoid string drift).

const Events = Object.freeze({
  // settings
  SETTINGS_CHANGED: 'settings:changed',
  // ocr / recording
  OCR_STATUS: 'ocr:status',
  OCR_PROGRESS: 'ocr:progress',
  LOG: 'log',
  // record (history line committed)
  HISTORY_UPDATED: 'history:updated', // {kind:'added'|'merged'|'updated', record}
  // batch recorder
  RECORDER_STATUS: 'recorder:status', // state snapshot
  BATCH_PROGRESS: 'batch:progress', // {chunk,total,done,failed,...}
  BATCH_DONE: 'batch:done',
  // match
  SUSPECT_HIT: 'match:suspect', // {raw, norm, candidates:[...]}
  // TM
  TM_UPDATED: 'tm:updated',
});

module.exports = Events;
