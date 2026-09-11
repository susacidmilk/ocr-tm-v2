// Visual-novel local prompt builder used by the LM Studio source.
// Builds the [History] / [Glossary] / [Input] structure the user requested.
// Glossary format: src->dst #备注 (may be empty). History grows to a cap.

function fmtLang(lang) {
  const m = {
    'en': 'English', 'english': 'English', 'ja': 'Japanese', '日文': 'Japanese', 'japanese': 'Japanese',
    'zh': '简体中文', 'zh-cn': '简体中文', 'chinese': '简体中文', '中文': '简体中文', '简中': '简体中文',
    'ko': 'Korean', 'korean': 'Korean',
  };
  const k = String(lang || '').toLowerCase().trim();
  return m[k] || lang || '';
}

// history: array of {raw, translated, revised?}
// glossaryText: string of "src -> dst #note" lines, may be ''.
function buildVnSystem(source, target) {
  const src = fmtLang(source);
  const tgt = fmtLang(target);
  return (
    'You are a visual novel translation model. Translate naturally from ' + src + ' to ' + tgt + ' ' +
    'using the given glossary, follow the context and story so far, and choose pronouns and ' +
    'subject/object correctly (do not confuse causative and passive voice roles). ' +
    'In [History], lines marked "[corrected]" are reference translations that were ' +
    'already fixed for consistency with the story; keep terminology, pronouns and style ' +
    'consistent with them. ' +
    'Do not add special symbols that are not in the source, and do not add or remove line breaks. ' +
    'Output ONLY the translation of the input line.'
  );
}

function buildGlossaryBlock(glossaryText) {
  const t = String(glossaryText || '').trim();
  return t ? t : '(none)';
}

function buildHistoryBlock(history, sourceLang, targetLang) {
  if (!history || !history.length) return '';
  const src = fmtLang(sourceLang);
  const tgt = fmtLang(targetLang);
  const lines = history.map((h) => {
    const raw = String(h.raw || '');
    const tr = String(h.translated || '');
    if (!tr) return `${src}: ${raw}`;
    const mark = h.revised ? '[corrected] ' : '';
    return `${mark}${src}: ${raw}\n${tgt}: ${tr}`;
  });
  return lines.join('\n');
}

// Returns { system, user } chat messages for the current raw line.
function buildVnMessages(raw, { sourceLang, targetLang, glossaryText, history } = {}) {
  const src = fmtLang(sourceLang);
  const tgt = fmtLang(targetLang);
  const hist = buildHistoryBlock(history, sourceLang, targetLang);
  const parts = [];
  if (hist) parts.push('[History]\n' + hist);
  parts.push('[Glossary]\n' + buildGlossaryBlock(glossaryText));
  parts.push(
    `Translate the following from ${src} to ${tgt}, using the glossary and history above. ` +
    `Output only the translation, no extra text.\n` +
    `[Input]\n${raw}`
  );
  return {
    system: buildVnSystem(sourceLang, targetLang),
    user: parts.join('\n\n'),
  };
}

module.exports = { buildVnMessages, buildGlossaryBlock, buildHistoryBlock, buildVnSystem, fmtLang };
