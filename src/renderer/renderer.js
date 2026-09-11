// Phase B renderer: settings form, mode switch, OCR toggle, batch recorder,
// history (compact) and TM views. Functional, not yet polished.

const $ = (id) => document.getElementById(id);
const els = {
  mode: $('mode'), statusBadge: $('statusBadge'), btnOcr: $('btnOcr'), btnNewSession: $('btnNewSession'),
  gameName: $('gameName'),
  translateSource: $('translateSource'), apiKeyLabel: $('apiKeyLabel'), apiKey: $('apiKey'),
  apiBase: $('apiBase'), model: $('model'), sourceHint: $('sourceHint'),
  sourceLang: $('sourceLang'), targetLang: $('targetLang'),
  boxX: $('boxX'), boxY: $('boxY'), boxW: $('boxW'), boxH: $('boxH'), btnPickBox: $('btnPickBox'),
  ocrIntervalMs: $('ocrIntervalMs'), stableFrames: $('stableFrames'),
  tmBatchSize: $('tmBatchSize'), tmBatchConcurrency: $('tmBatchConcurrency'), tmReasoningEffort: $('tmReasoningEffort'),
  showRegionFrame: $('showRegionFrame'),
  overlayFontSize: $('overlayFontSize'), overlayOriginalFontSize: $('overlayOriginalFontSize'), overlayWidth: $('overlayWidth'), localContextWindow: $('localContextWindow'),
  glossSource: $('glossSource'), glossTarget: $('glossTarget'), glossNote: $('glossNote'),
  btnGlossAdd: $('btnGlossAdd'), glossaryList: $('glossaryList'),
  showOverlay: $('showOverlay'), overlayLocked: $('overlayLocked'),
  btnTestOcr: $('btnTestOcr'), lastOcr: $('lastOcr'), logbar: $('logbar'),
  recPanel: $('recPanel'), recCount: $('recCount'), recList: $('recList'),
  btnRecStart: $('btnRecStart'), btnRecStop: $('btnRecStop'), btnRecReset: $('btnRecReset'), btnRecTranslate: $('btnRecTranslate'),
  tabHistory: $('tabHistory'), tabTm: $('tabTm'), viewHistory: $('viewHistory'), viewTm: $('viewTm'),
  layoutTwo: $('layoutTwo'), layoutSingle: $('layoutSingle'),
  historyList: $('historyList'), tmList: $('tmList'), tmSearch: $('tmSearch'),
  btnClearHist: $('btnClearHist'), btnTmClear: $('btnTmClear'), btnTmExportJson: $('btnTmExportJson'), btnTmExportTxt: $('btnTmExportTxt'), histCount: $('histCount'),
  suspectBar: $('suspectBar'), sbText: $('sbText'), sbCands: $('sbCands'), btnSbIgnore: $('btnSbIgnore'),
  recProg: $('recProg'),
};

let S = null;
let currentTab = 'history';
let ocrRunning = false;

function currentLayout() {
  return S && S.listLayout === 'single' ? 'single' : 'two';
}

function refreshMode() {
  const isRec = S.mode === 'record';
  els.recPanel.classList.toggle('hidden', !isRec);
}

function status(label, cls) {
  els.statusBadge.textContent = label;
  els.statusBadge.className = 'badge' + (cls ? ' ' + cls : '');
}

function log(msg) {
  els.logbar.textContent = msg;
}

function saveSetting(patch) {
  return window.ocrTm.settings.save(patch).then((s) => { S = s; refreshMode(); });
}

function activeSrc() {
  const k = S && S.translateSource === 'lmstudio' ? 'lmstudio' : 'deepseek';
  const b = (S && S.sources && S.sources[k]) || {};
  return { key: k, bundle: b };
}

const SOURCE_META = {
  deepseek: {
    name: '☁️ DeepSeek（远程）',
    apiKeyLabel: 'API Key',
    apiKeyPh: 'sk-...',
    basePh: 'https://api.deepseek.com',
    hint: '云端翻译，质量稳定；实时/批量/重翻都会用它。需要外网与有效 API Key。',
  },
  lmstudio: {
    name: '🔌 本地 LM Studio',
    apiKeyLabel: 'API Key（本地可不填）',
    apiKeyPh: 'lm-studio 或留空',
    basePh: 'http://127.0.0.1:1234/v1',
    hint: '连本机 LM Studio 的 OpenAI 兼容服务。需先在 LM Studio 里加载模型（默认模型名如 translat），无需 API Key。',
  },
};

function refreshSourceForm() {
  const a = activeSrc();
  const meta = SOURCE_META[a.key];
  els.translateSource.value = a.key;
  els.apiKey.value = a.bundle.apiKey || '';
  els.apiBase.value = a.bundle.apiBase || (a.key === 'lmstudio' ? SOURCE_META.lmstudio.basePh : SOURCE_META.deepseek.basePh);
  els.model.value = a.bundle.model || (a.key === 'lmstudio' ? 'translat' : 'deepseek-chat');
  els.apiKeyLabel.textContent = meta.apiKeyLabel;
  els.apiKey.placeholder = meta.apiKeyPh;
  els.apiBase.placeholder = meta.basePh;
  els.model.placeholder = a.key === 'lmstudio' ? 'LM Studio 中加载的模型名' : 'deepseek-chat';
  els.sourceHint.textContent = meta.hint;
}

async function load() {
  S = await window.ocrTm.settings.get();
  els.mode.value = S.mode;
  els.gameName.value = S.gameName || '';
  els.sourceLang.value = S.sourceLang || '';
  els.targetLang.value = S.targetLang || '';
  els.boxX.value = (S.box && S.box.x) || 0;
  els.boxY.value = (S.box && S.box.y) || 0;
  els.boxW.value = (S.box && S.box.width) || 100;
  els.boxH.value = (S.box && S.box.height) || 80;
  els.ocrIntervalMs.value = S.ocrIntervalMs || 300;
  els.stableFrames.value = S.stableFrames || 3;
  els.tmBatchSize.value = S.tmBatchSize != null ? S.tmBatchSize : 70;
  els.tmBatchConcurrency.value = S.tmBatchConcurrency != null ? S.tmBatchConcurrency : 3;
  els.tmReasoningEffort.value = S.tmReasoningEffort === 'low' || S.tmReasoningEffort === 'high' ? S.tmReasoningEffort : 'off';
  els.showOverlay.checked = S.showOverlay !== false;
  els.overlayLocked.checked = S.overlayLocked !== false;
  els.showRegionFrame.checked = S.showRegionFrame !== false;
  els.overlayFontSize.value = S.overlayFontSize != null ? S.overlayFontSize : 20;
  els.overlayOriginalFontSize.value = S.overlayOriginalFontSize != null ? S.overlayOriginalFontSize : 13;
  els.overlayWidth.value = S.overlayWidth != null ? S.overlayWidth : 520;
  els.localContextWindow.value = S.localContextWindow != null ? S.localContextWindow : 20;
  refreshSourceForm();
  refreshMode();
  setLayoutButtons();
  refreshHistory();
  refreshGlossary();
}

function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---- settings form -> save into the ACTIVE source bundle + flat fields
const persistSettings = debounce(async () => {
  const a = activeSrc();
  const patch = {
    mode: els.mode.value,
    gameName: els.gameName.value.trim(),
    sourceLang: els.sourceLang.value.trim(),
    targetLang: els.targetLang.value.trim(),
    box: { x: Number(els.boxX.value) || 0, y: Number(els.boxY.value) || 0, width: Number(els.boxW.value) || 100, height: Number(els.boxH.value) || 80 },
    ocrIntervalMs: Number(els.ocrIntervalMs.value) || 300,
    stableFrames: Number(els.stableFrames.value) || 3,
    tmBatchSize: Number(els.tmBatchSize.value) || 70,
    tmBatchConcurrency: Number(els.tmBatchConcurrency.value) || 3,
    tmReasoningEffort: els.tmReasoningEffort.value,
    showOverlay: els.showOverlay.checked,
    overlayLocked: els.overlayLocked.checked,
    showRegionFrame: els.showRegionFrame.checked,
    overlayFontSize: Number(els.overlayFontSize.value) || 20,
    overlayOriginalFontSize: Number(els.overlayOriginalFontSize.value) || 13,
    overlayWidth: Number(els.overlayWidth.value) || 520,
    localContextWindow: Number(els.localContextWindow.value) || 20,
    sources: { [a.key]: { apiKey: els.apiKey.value.trim(), apiBase: els.apiBase.value.trim(), model: els.model.value.trim() } },
  };
  S = await window.ocrTm.settings.save(patch);
}, 400);
['gameName','sourceLang','targetLang','ocrIntervalMs','stableFrames'].forEach((id) => els[id].addEventListener('input', persistSettings));
[els.boxX, els.boxY, els.boxW, els.boxH].forEach((e) => e.addEventListener('change', persistSettings));
els.apiKey.addEventListener('change', persistSettings);
els.apiBase.addEventListener('change', persistSettings);
els.model.addEventListener('change', persistSettings);
[els.tmBatchSize, els.tmBatchConcurrency].forEach((e) => e.addEventListener('change', persistSettings));
els.tmReasoningEffort.addEventListener('change', persistSettings);
[els.overlayFontSize, els.overlayOriginalFontSize, els.overlayWidth, els.localContextWindow].forEach((e) => e.addEventListener('change', persistSettings));
[els.showOverlay, els.overlayLocked, els.showRegionFrame].forEach((c) => c.addEventListener('change', persistSettings));

// switching translation source: persist current UI edits into the old bundle,
// then flip translateSource; the server keeps each bundle independent.
els.translateSource.addEventListener('change', async () => {
  // a.key = the source that is active BEFORE the flip (S unchanged yet)
  const a = activeSrc();
  await window.ocrTm.settings.save({
    sources: { [a.key]: { apiKey: els.apiKey.value.trim(), apiBase: els.apiBase.value.trim(), model: els.model.value.trim() } },
  });
  const next = els.translateSource.value;
  S = await window.ocrTm.settings.save({ translateSource: next });
  refreshSourceForm();
  log(`🧭 翻译源切换为 ${SOURCE_META[next].name}`);
});

function refreshBoxFields() {
  if (!S || !S.box) return;
  els.boxX.value = S.box.x;
  els.boxY.value = S.box.y;
  els.boxW.value = S.box.width;
  els.boxH.value = S.box.height;
}

// mouse-drag region picker (fullscreen transparent window in main)
els.btnPickBox.addEventListener('click', async () => {
  await window.ocrTm.box.startPick();
  log('🖱 请在屏幕上拖拽框住对白文字区域（Esc 取消）');
});

// mode toggle
els.mode.addEventListener('change', async () => {
  await window.ocrTm.settings.save({ mode: els.mode.value });
  S = await window.ocrTm.settings.get();
  refreshMode();
  updateStatusBadge();
  log('已切换到 ' + (S.mode === 'record' ? '批量录制' : '实时逐句翻译'));
});

// OCR toggle
els.btnOcr.addEventListener('click', async () => {
  if (ocrRunning) { await window.ocrTm.ocr.stop(); ocrRunning = false; els.btnOcr.textContent = '▶ 开始 OCR'; updateStatusBadge(); }
  else {
    await window.ocrTm.settings.save({ mode: els.mode.value });
    await window.ocrTm.ocr.start();
    ocrRunning = true; els.btnOcr.textContent = '⏹ 停止 OCR';
    updateStatusBadge();
  }
});

els.btnNewSession.addEventListener('click', async () => {
  const r = await window.ocrTm.session.new();
  log('新会话 ' + r.sessionId);
  refreshHistory();
});

els.btnTestOcr.addEventListener('click', async () => {
  const r = await window.ocrTm.ocr.test();
  els.lastOcr.textContent = r.error ? '❌ ' + r.error : (r.text || '(空)');
});

// ---- recorder ----
els.btnRecStart.addEventListener('click', async () => {
  if (!ocrRunning) { await window.ocrTm.ocr.start(); ocrRunning = true; els.btnOcr.textContent = '⏹ 停止 OCR'; }
  await window.ocrTm.recorder.start();
  log('🎙 开始录制（挂机 OCR 收集中，停止后即可整段翻译）');
});
els.btnRecStop.addEventListener('click', async () => {
  await window.ocrTm.recorder.stop();
  log('🎙 已停止录制，可整段翻译');
  recListCache = await window.ocrTm.recorder.list();
  renderRecList(recListCache);
});
els.btnRecReset.addEventListener('click', async () => { recListCache = []; renderRecList([]); await window.ocrTm.recorder.reset(); log('已清空录制清单'); });
els.btnRecTranslate.addEventListener('click', async () => {
  log('整段翻译中…');
  const r = await window.ocrTm.recorder.translate();
  recListCache = [];
  renderRecList([]);
  log(r.error ? '❌ ' + r.error : `✅ 完成 ${r.ok}/${r.totalLines} 句`);
  refreshHistory(); refreshTm();
});

// ---- tabs ----
els.tabHistory.addEventListener('click', () => setTab('history'));
els.tabTm.addEventListener('click', () => setTab('tm'));
function setTab(t) {
  currentTab = t;
  els.tabHistory.classList.toggle('active', t === 'history');
  els.tabTm.classList.toggle('active', t === 'tm');
  els.viewHistory.classList.toggle('hidden', t !== 'history');
  els.viewTm.classList.toggle('hidden', t !== 'tm');
  if (t === 'tm') refreshTm();
}

function setLayoutButtons() {
  const l = currentLayout();
  els.layoutTwo.classList.toggle('active', l === 'two');
  els.layoutSingle.classList.toggle('active', l === 'single');
  // refresh whichever list is visible so rows match the mode
  if (!els.viewHistory.classList.contains('hidden')) refreshHistory();
  if (!els.viewTm.classList.contains('hidden')) refreshTm();
}
els.layoutTwo.addEventListener('click', async () => {
  S = await window.ocrTm.settings.save({ listLayout: 'two' });
  setLayoutButtons();
});
els.layoutSingle.addEventListener('click', async () => {
  S = await window.ocrTm.settings.save({ listLayout: 'single' });
  setLayoutButtons();
});

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}
function statusText(r) {
  if (r.translated) return r.translated;
  if (r.status === 'error') return '❌ ' + (r.error || '');
  if (r.status === 'translating') return '…翻译中';
  return '…';
}

// ---- history (two display modes; see currentLayout) ----
function renderHistory(records) {
  els.histCount.textContent = records.length ? `${records.length} 行` : '';
  if (!records.length) { els.historyList.innerHTML = '<div class="muted">暂无历史</div>'; return; }
  const rows = records.slice().reverse();
  const single = currentLayout() === 'single';
  const items = rows.map((r) => {
    const trans = statusText(r);
    const t = fmtTime(r.lastSeenAt || r.firstSeenAt);
    const ttlEarly = '最早 ' + fmtTime(r.firstSeenAt);
    const cls = r.status === 'error' ? 'err' : '';
    const actions =
      `<span class="hist-actions">
        <button class="small" data-act="retranslate" data-id="${r.id}">↻ 重翻</button>
        <button class="small danger" data-act="delete" data-id="${r.id}">删除</button>
      </span>`;
    if (single) {
      // one line: full original + truncated translation, actions inline
      return `<div class="hist-row single">
        <span class="hist-meta" title="${ttlEarly}">${t}·${r.count}</span>
        <span class="hist-raw" title="${esc(r.rawFirst)}">${esc(r.rawFirst)}</span>
        <span class="hist-arrow">→</span>
        <span class="hist-trans ${cls}" title="${esc(trans)}">${esc(trans)}</span>
        ${actions}
      </div>`;
    }
    // two full lines: original line, then translation line (both full)
    return `<div class="hist-block">
      <div class="h-head"><span class="hist-meta" title="${ttlEarly}">${t} · 出现 ${r.count} 次</span>${actions}</div>
      <div class="h-orig" title="${esc(r.rawFirst)}">${esc(r.rawFirst)}</div>
      <div class="h-trans ${cls}">${esc(trans)}</div>
    </div>`;
  }).join('\n');
  els.historyList.innerHTML = items;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

async function refreshHistory() {
  const list = await window.ocrTm.history.list();
  renderHistory(list);
}
els.btnClearHist.addEventListener('click', async () => { await window.ocrTm.history.clear(); refreshHistory(); });

// History row actions (delegated): 重翻 updates only the row + TM, never overlay.
els.historyList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const act = btn.getAttribute('data-act');
  if (!id) return;
  if (act === 'delete') {
    await window.ocrTm.history.deleteOne(id);
    refreshHistory();
  } else if (act === 'retranslate') {
    btn.disabled = true;
    btn.textContent = '…';
    const r = await window.ocrTm.history.retranslate(id);
    btn.disabled = false;
    btn.textContent = '↻ 重翻';
    if (r && r.translated) log('↻ 已重新翻译（仅更新本条记录，不影响悬浮层）');
    else if (r && r.error) log('❌ 重翻失败：' + r.error);
    refreshHistory();
  }
});

// ---- TM ----
async function refreshTm() {
  const { snapshot, total } = await window.ocrTm.tm.summary();
  tmTotalCached = total;
  updateStatusBadge();
  const q = (els.tmSearch.value || '').trim();
  const rows = q ? snapshot.filter((e) => (e.raw + ' ' + (e.translated || '')).toLowerCase().includes(q.toLowerCase())) : snapshot;
  const single = currentLayout() === 'single';
  const items = rows.slice().reverse().map((e) => {
    const trans = e.translated || (e.status === 'error' ? '❌' : '…');
    if (single) {
      return `<div class="tm-row single"><span class="tm-raw" title="${esc(e.raw)}">${esc(e.raw)}</span>
       <span class="tm-arrow">→</span><span class="tm-trans">${esc(trans)}</span>
       <span class="tm-meta">${e.model}·hits ${e.hits||0}</span>
       <button class="small danger" data-act="tm-delete" data-id="${e.id}">✕</button></div>`;
    }
    return `<div class="tm-block">
      <div class="h-head"><span class="tm-raw-full">${esc(e.raw)}</span><button class="small danger" data-act="tm-delete" data-id="${e.id}">✕</button></div>
      <div class="h-trans">${esc(trans)}</div>
      <div class="tm-meta">${e.model} · hits ${e.hits||0} · ${e.status}</div>
    </div>`;
  }).join('\n');
  els.tmList.innerHTML = items || '<div class="muted">暂无翻译记忆</div>';
}
els.tmSearch.addEventListener('input', debounce(refreshTm, 250));
els.btnTmClear.addEventListener('click', async () => { await window.ocrTm.tm.clear(); refreshTm(); });
els.btnTmExportJson.addEventListener('click', async () => { const r = await window.ocrTm.tm.export(undefined, 'json'); if (!r.canceled) log(`✅ 已导出 JSON ${r.count} 条`); });
els.btnTmExportTxt.addEventListener('click', async () => { const r = await window.ocrTm.tm.export(undefined, 'txt'); if (!r.canceled) log(`✅ 已导出 TXT ${r.count} 条`); });
els.tmList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  await window.ocrTm.tm.deleteOne(undefined, btn.getAttribute('data-id'));
  refreshTm();
});

function renderRecList(lines) {
  els.recCount.textContent = lines.length + ' 句';
  if (!lines.length) {
    els.recList.innerHTML = '<div class="muted">（空）</div>';
    els.recList.dataset.empty = '1';
    return;
  }
  els.recList.dataset.empty = '0';
  els.recList.innerHTML = lines.map((l, i) =>
    `<div class="rec-row" data-idx="${i}">
      <span class="rec-no">${i + 1}.</span>
      <span class="rec-text" title="点击 ✎ 可修正 OCR 误识">${esc(l)}</span>
      <span class="rec-ops">
        <button class="tiny" data-act="edit" data-idx="${i}" title="编辑/修正这句原文">✎</button>
        <button class="tiny danger" data-act="del" data-idx="${i}" title="删除这句">✕</button>
      </span>
    </div>`).join('');
}

// per-row edit: swap row into an inline input + save/cancel
function startRecEdit(idx, line) {
  const row = els.recList.querySelector(`.rec-row[data-idx="${idx}"]`);
  if (!row) return;
  row.innerHTML =
    `<input class="rec-edit-input" data-idx="${idx}" value="${escAttr(line)}" />` +
    `<button class="tiny" data-act="save-edit" data-idx="${idx}">✓</button>` +
    `<button class="tiny" data-act="cancel-edit" data-idx="${idx}">✕</button>`;
  const inp = row.querySelector('input');
  if (inp) {
    inp.focus();
    inp.select();
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveRecEdit(idx);
      else if (e.key === 'Escape') renderRecList(recListCache);
    });
  }
}
let recListCache = [];

async function saveRecEdit(idx) {
  const inp = els.recList.querySelector(`.rec-edit-input[data-idx="${idx}"]`);
  const val = inp ? inp.value.trim() : '';
  if (!val) return;
  recListCache = await window.ocrTm.recorder.editAt(idx, val);
  renderRecList(recListCache);
}

els.recList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  const idx = Number(btn.getAttribute('data-idx'));
  if (act === 'del') {
    recListCache = await window.ocrTm.recorder.removeAt(idx);
    renderRecList(recListCache);
  } else if (act === 'edit') {
    const line = (recListCache[idx] != null ? recListCache[idx] : (await window.ocrTm.recorder.list())[idx]) || '';
    startRecEdit(idx, line);
  } else if (act === 'save-edit') {
    saveRecEdit(idx);
  } else if (act === 'cancel-edit') {
    renderRecList(recListCache);
  }
});

function escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- suspect-hit confirmation bar ----
let suspectRaw = null;
function showSuspect(raw, candidates) {
  suspectRaw = raw;
  suspectCandsCache = candidates || [];
  els.sbText.textContent = raw;
  els.sbCands.innerHTML = (candidates || [])
    .map(
      (c) =>
        `<button class="sb-cand" data-raw="${escAttr(raw)}" data-id="${c.id}" title="TM原文: ${escAttr(c.raw)}">${esc(c.translated)}</button>`
    )
    .join('');
  els.suspectBar.classList.remove('hidden');
}
function hideSuspect() {
  suspectRaw = null;
  els.suspectBar.classList.add('hidden');
  els.sbCands.innerHTML = '';
}

els.sbCands.addEventListener('click', async (e) => {
  const btn = e.target.closest('.sb-cand');
  if (!btn) return;
  const raw = btn.getAttribute('data-raw');
  const id = btn.getAttribute('data-id');
  // find candidate to pass full translated text
  const cand = (suspectCandsCache || []).find((c) => c.id === id) || { translated: btn.textContent };
  await window.ocrTm.match.adopt(raw, cand);
  hideSuspect();
  refreshHistory(); refreshTm();
});
els.btnSbIgnore.addEventListener('click', async () => {
  if (!suspectRaw) return;
  await window.ocrTm.match.ignore(suspectRaw);
  hideSuspect();
  refreshHistory(); refreshTm();
});
let suspectCandsCache = [];

// ---- glossary (current game) ----
async function refreshGlossary() {
  const game = (S && S.gameName) || '';
  if (!game) { els.glossaryList.innerHTML = '<div class="muted">先填游戏名</div>'; return; }
  const entries = await window.ocrTm.glossary.list(game);
  if (!entries.length) { els.glossaryList.innerHTML = '<div class="muted">（暂无术语）</div>'; return; }
  els.glossaryList.innerHTML = entries.map((g) =>
    `<div class="gloss-row" data-id="${g.id}">
      <input type="checkbox" ${g.enabled === false ? '' : 'checked'} data-act="toggle" />
      <span class="gs">${esc(g.source)}</span><span class="arrow">→</span><span class="gt">${esc(g.target)}</span>
      <span class="gn">${g.note ? '#' + esc(g.note) : ''}</span>
      <button class="danger" data-act="del" data-id="${g.id}">✕</button>
    </div>`).join('');
}
els.btnGlossAdd.addEventListener('click', async () => {
  const source = els.glossSource.value.trim();
  const target = els.glossTarget.value.trim();
  if (!source || !target) return log('术语需填原文与译文');
  const game = (S && S.gameName) || '';
  if (!game) return log('先填游戏名称');
  await window.ocrTm.glossary.add({ game, source, target, note: els.glossNote.value.trim() });
  els.glossSource.value = ''; els.glossTarget.value = ''; els.glossNote.value = '';
  refreshGlossary();
});
els.glossaryList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  const chk = e.target.closest('input[data-act=toggle]');
  if (btn && btn.getAttribute('data-act') === 'del') {
    await window.ocrTm.glossary.delete(btn.getAttribute('data-id'));
    refreshGlossary();
  } else if (chk) {
    await window.ocrTm.glossary.toggle({ id: chk.closest('.gloss-row').getAttribute('data-id'), enabled: chk.checked });
  }
});

// ---- events from main ----
let lastRawShown = '';
function updateStatusBadge() {
  const modeLabel = S && S.mode === 'record' ? '批量' : '实时';
  const recLabel = S && S.mode === 'record' ? `🎙${recCount}` : '';
  const tmTotal = tmTotalCached;
  if (ocrRunning) {
    status(`${modeLabel}·识别中${recLabel ? ' ' + recLabel : ''}${tmTotal != null ? ` ·TM ${tmTotal}` : ''}`, 'run');
  } else {
    status(`待机${tmTotal != null ? ` ·TM ${tmTotal}` : ''}`);
  }
}
let tmTotalCached = null;
let recCount = 0;

async function refreshTmCount() {
  try {
    const r = await window.ocrTm.tm.summary();
    tmTotalCached = r.total;
    updateStatusBadge();
  } catch { /* ignore */ }
}

window.ocrTm.onEvent((ev) => {
  switch (ev.type) {
    case 'log': log(ev.data); break;
    case 'match:suspect':
      if (ev.data && ev.data.raw && Array.isArray(ev.data.candidates) && ev.data.candidates.length) {
        showSuspect(ev.data.raw, ev.data.candidates);
      }
      break;
    case 'batch:progress':
      if (ev.data) {
        const p = ev.data;
        els.recProg.textContent =
          p.status === 'translating'
            ? `整段翻译… 块 ${p.chunk}/${p.total}（已 ${p.done} 条）`
            : p.status === 'failed'
              ? `⚠ 块 ${p.chunk}/${p.total} 失败：${p.error || ''}`
              : `块 ${p.chunk}/${p.total} 完成（已 ${p.done} 条）`;
        els.recProg.classList.remove('hidden');
      }
      break;
    case 'recorder:status':
      recCount = ev.data.count || 0;
      els.recCount.textContent = recCount + ' 句';
      if (Array.isArray(ev.data.lines)) {
        recListCache = ev.data.lines;
        renderRecList(recListCache);
      }
      updateStatusBadge();
      break;
    case 'ocr:progress':
      // live preview of what OCR currently sees (useful to align the box)
      if (ev.data && typeof ev.data.raw === 'string') {
        lastRawShown = ev.data.raw;
        els.lastOcr.textContent = ev.data.raw ? '👁 ' + ev.data.raw : '(当前画面无文字)';
      }
      break;
    case 'ocr:status':
      ocrRunning = !!ev.data.running;
      if (!ocrRunning) {
        els.btnOcr.textContent = '▶ 开始 OCR';
        if (ev.data.reason) { els.lastOcr.textContent = '⚠️ ' + ev.data.reason; log(ev.data.reason); }
      }
      updateStatusBadge();
      break;
    case 'history:updated': refreshHistory(); break;
    case 'batch:done': els.recProg.classList.add('hidden'); refreshTm(); refreshHistory(); refreshTmCount(); break;
    case 'tm:updated': refreshTm(); refreshTmCount(); break;
    case 'settings:changed':
      S = ev.data || S;
      refreshBoxFields();
      refreshMode();
      // only repaint source fields when the ACTIVE SOURCE actually changed
      // (typing in a field broadcasts too; repainting would clobber the cursor)
      if (els.translateSource.value !== S.translateSource) refreshSourceForm();
      updateStatusBadge();
      break;
  }
});

load().then(() => {
  refreshHistory();
  updateStatusBadge();
  refreshTmCount();
});
