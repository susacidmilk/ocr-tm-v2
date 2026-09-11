// Provider contract that every translation source implements. Keeping the
// interface small decouples OCR/history/batch code from any specific vendor.

/*
 * A "provider" object exposes:
 *   key: 'deepseek' | 'lmstudio'
 *   label: string (human readable)
 *   supportsStreaming: boolean
 *   translateLine(line, { onPartial, cfg }) -> Promise<string>
 *       - Translate a single line (may stream partial tokens to onPartial).
 *   translateBatch(lines, cfg) -> Promise<Array<string>>
 *       - Translate N lines in ONE request, returning EXACTLY N translations in
 *         the same order. This is the alignment-critical path used by batch mode.
 *   cfg: { apiKey, apiBase, model, sourceLang, targetLang, contextLines?, glossary? }
 */

module.exports = {}; // interface documentation only
