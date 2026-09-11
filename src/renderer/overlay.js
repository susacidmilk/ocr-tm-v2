// Floating overlay renderer: shows the current live line's original + translation.
// Listens for 'overlay' events broadcast by main (same channel as the main window).

const transEl = document.getElementById('trans');
const srcEl = document.getElementById('src');
const errEl = document.getElementById('err');
const badgeEl = document.getElementById('badge');

let curFontSize = 20;
let curSrcFontSize = 13;

function applyFonts() {
  transEl.style.fontSize = curFontSize + 'px';
  srcEl.style.fontSize = curSrcFontSize + 'px';
  autosize();
}

function autosize() {
  const h = Math.ceil(document.body.scrollHeight + 12);
  window.ocrTm.overlay.autosize(h);
}

function setLabel(el, text) {
  const label = el.querySelector('.label');
  if (label) {
    // keep the label span as prefix
  }
}

function render(data) {
  const d = data || {};
  // main attaches current display settings to each overlay payload
  if (Number(d.overlayFontSize)) curFontSize = Number(d.overlayFontSize);
  if (Number(d.overlayOriginalFontSize)) curSrcFontSize = Number(d.overlayOriginalFontSize);
  const src = String(d.raw || '');
  const trans = String(d.translated || '');
  const err = d.status === 'error' ? String(d.error || '翻译失败') : '';
  const translating = d.status === 'translating' && !trans;

  badgeEl.textContent =
    d.status === 'error' ? '❌'
    : translating ? '…翻译中'
    : d.fromTm ? '💾 TM'
    : d.src === 'deepseek' ? '☁️ DeepSeek'
    : d.src === 'lmstudio' ? '🔌 LM Studio'
    : (d.src || '');

  if (err) {
    errEl.style.display = 'block';
    errEl.textContent = err;
    transEl.textContent = '';
    srcEl.textContent = src;
  } else {
    errEl.style.display = 'none';
    // keep a label prefix for readability
    if (trans || translating) {
      transEl.innerHTML = '<span class="label">译文</span>' + escapeHtml(trans || '…');
    } else {
      transEl.innerHTML = '<span class="label">译文</span>';
    }
    srcEl.innerHTML = src ? '<span class="label">原文</span>' + escapeHtml(src) : '';
  }
  applyFonts();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// initial: pull display settings once; then keep local sizes updated on each event.
async function init() {
  try {
    const s = await window.ocrTm.settings.get();
    curFontSize = Number(s.overlayFontSize) || 20;
    curSrcFontSize = Number(s.overlayOriginalFontSize) || 13;
    applyFonts();
  } catch {
    /* defaults stay */
  }
  window.ocrTm.onEvent((ev) => {
    if (ev && ev.type === 'overlay') render(ev.data);
  });
}

init();
