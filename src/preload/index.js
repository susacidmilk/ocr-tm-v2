const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ocrTm', {
  // settings / session
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
  },
  session: {
    new: () => ipcRenderer.invoke('session:new'),
  },
  // OCR
  ocr: {
    start: () => ipcRenderer.invoke('ocr:start'),
    stop: () => ipcRenderer.invoke('ocr:stop'),
    test: () => ipcRenderer.invoke('ocr:test'),
  },
  // region picker (mouse drag to box the capture area)
  box: {
    startPick: () => ipcRenderer.invoke('box:pick-start'),
    submitPick: (rect) => ipcRenderer.invoke('box:pick-result', rect),
    cancelPick: () => ipcRenderer.invoke('box:pick-cancel'),
  },
  // batch recorder
  recorder: {
    start: () => ipcRenderer.invoke('rec:start'),
    stop: () => ipcRenderer.invoke('rec:stop'),
    reset: () => ipcRenderer.invoke('rec:reset'),
    list: () => ipcRenderer.invoke('rec:list'),
    translate: () => ipcRenderer.invoke('rec:translate'),
    removeAt: (idx) => ipcRenderer.invoke('rec:remove', idx),
    editAt: (idx, raw) => ipcRenderer.invoke('rec:edit', { idx, raw }),
  },
  // TM
  tm: {
    summary: (game) => ipcRenderer.invoke('tm:summary', game),
    search: (opts) => ipcRenderer.invoke('tm:search', opts),
    clear: (game) => ipcRenderer.invoke('tm:clear', game),
    deleteOne: (game, id) => ipcRenderer.invoke('tm:delete-one', { game, id }),
    export: (game, format) => ipcRenderer.invoke('tm:export', { game, format }),
    translateList: (opts) => ipcRenderer.invoke('tm:translate-list', opts),
  },
  // history
  history: {
    list: (sessionId) => ipcRenderer.invoke('history:list', sessionId),
    clear: () => ipcRenderer.invoke('history:clear'),
    deleteOne: (id) => ipcRenderer.invoke('history:delete-one', id),
    retranslate: (id) => ipcRenderer.invoke('history:retranslate', id),
  },
  // glossary
  glossary: {
    list: (game) => ipcRenderer.invoke('glossary:list', game),
    add: (entry) => ipcRenderer.invoke('glossary:add', entry),
    toggle: (opts) => ipcRenderer.invoke('glossary:toggle', opts),
    delete: (id) => ipcRenderer.invoke('glossary:delete', id),
  },
  // match
  match: {
    adopt: (raw, candidate) => ipcRenderer.invoke('match:adopt', { raw, candidate }),
    ignore: (raw) => ipcRenderer.invoke('match:ignore', { raw }),
  },
  // events from main
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:event', listener);
    return () => ipcRenderer.removeListener('app:event', listener);
  },

  // floating overlay (used by overlay window renderer)
  overlay: {
    autosize: (h) => ipcRenderer.invoke('overlay:autosize', h),
    setLocked: (locked) => ipcRenderer.invoke('overlay:set-locked', locked),
    hide: () => ipcRenderer.invoke('overlay:hide'),
  },
});
