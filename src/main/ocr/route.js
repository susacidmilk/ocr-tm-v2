// Router: decides what happens when a stabilised OCR line is committed, based on
// the current mode. Kept free of electron so it can be unit-tested with injected
// dependencies.
//
// ctx (provided by the app):
//   getMode() -> 'live'|'record'
//   normOf(raw) -> string
//   exactHit(raw) -> tm entry | null          (canonical TM lookup)
//   recordHistory(raw) -> {record, merged}    (session history upsert)
//   setRecordTranslated(id, patch) -> void
//   hasInFlight(norm)/markInFlight(norm)/clearInFlight(norm)
//   translateLive(raw, onPartial) -> Promise<string>
//   showOverlay(recordData) -> void
//   emitSuspect(raw, candidates) -> void
//   recorder.add(raw, norm) -> {added}
//   suspectCandidates(raw) -> [{id,raw,translated,similarity}]
//   log(msg) -> void
//   sourceLang/targetLang

const { MODES } = require('../../shared/constants');

function createRouter(ctx) {
  async function commit(raw) {
    const text = String(raw || '').trim();
    if (!text) return { action: 'empty' };
    const norm = ctx.normOf(text);
    if (!norm) return { action: 'empty' };

    if (ctx.getMode() === MODES.RECORD) {
      const res = ctx.recorder.add(text, norm);
      if (res.added) ctx.log(`🎙 已收录第 ${ctx.recorderCount()} 句`);
      return { action: 'recorded', added: res.added, reason: res.reason };
    }

    // LIVE mode -------------------------------------------------------------
    // 1) canonical TM hit -> instant show, no API.
    const tmHit = ctx.exactHit(text);
    if (tmHit) {
      const { record, merged } = ctx.recordHistory(text);
      ctx.setRecordTranslated(record.id, {
        translated: tmHit.translated,
        model: tmHit.model,
        src: tmHit.src,
        revised: !!(tmHit.meta && tmHit.meta.revised),
      });
      ctx.registerTmHit(tmHit.id);
      ctx.showOverlay({
        id: record.id,
        raw: text,
        translated: tmHit.translated,
        model: tmHit.model,
        src: tmHit.src,
        fromTm: true,
        merged,
      });
      ctx.log(`💾 TM 命中：${text.slice(0, 40)}`);
      return { action: 'tm-hit', entry: tmHit };
    }

    // 2) suspect hit (no exact) -> surface for human confirmation, no API yet.
    if (ctx.suspectCandidates) {
      const cands = ctx.suspectCandidates(text);
      if (cands.length) {
        ctx.emitSuspect(text, cands);
        return { action: 'suspect', candidates: cands };
      }
    }

    // 3) already translating/pending this line -> don't double-request.
    if (ctx.hasInFlight(norm)) {
      const { record, merged } = ctx.recordHistory(text);
      return { action: 'in-flight', merged };
    }

    // 4) translate live.
    ctx.markInFlight(norm);
    const { record, merged } = ctx.recordHistory(text);
    const recId = record.id;
    ctx.log(`🌐 实时翻译：${text.slice(0, 50)}`);
    try {
      const translated = await ctx.translateLive(text, (partial) => {
        ctx.showOverlay({ id: recId, raw: text, status: 'translating', translated: partial });
      });
      ctx.setRecordTranslated(recId, { translated });
      ctx.storeTm(text, translated, ctx.model(), ctx.source ? ctx.source() : 'live');
      ctx.clearInFlight(norm);
      ctx.showOverlay({ id: recId, raw: text, translated, status: 'translated' });
      return { action: 'translated', translated, merged };
    } catch (err) {
      ctx.clearInFlight(norm);
      const msg = err && err.message ? err.message : String(err);
      ctx.setRecordTranslated(recId, { translated: null, status: 'error', error: msg });
      ctx.log(`❌ 翻译失败：${msg}`);
      return { action: 'error', error: msg };
    }
  }

  return { commit };
}

module.exports = { createRouter };
