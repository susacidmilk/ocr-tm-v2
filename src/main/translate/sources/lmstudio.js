// Local LM Studio provider (OpenAI-compatible). Same Provider interface as
// DeepSeek. Streaming single-line translation is primary; batch JSON-array mode
// is supported but lower-reliability for alignment (fine for LM Studio / local).

const { SOURCES } = require('../../../shared/constants');
const { extractJsonArray } = require('./deepseek');
const { buildVnMessages } = require('../vnprompt');

function makeCfg(bundle, settings) {
  return {
    apiKey: bundle.apiKey || 'lm-studio',
    apiBase: (bundle.apiBase || 'http://127.0.0.1:1234/v1').trim().replace(/\/+$/, ''),
    model: bundle.model || 'translat',
    sourceLang: settings.sourceLang || 'English',
    targetLang: settings.targetLang || 'Simplified Chinese',
  };
}

function createLmStudioProvider(bundle, settings) {
  const cfg = () => makeCfg(bundle, settings);
  return {
    key: SOURCES.LMSTUDIO,
    label: '本地 LM Studio',
    supportsStreaming: true,
    async translateLine(line, opts = {}) {
      const c = cfg();
      const onPartial = opts && opts.onPartial;
      const m = buildVnMessages(String(line), {
        sourceLang: (opts && opts.sourceLang) || c.sourceLang,
        targetLang: (opts && opts.targetLang) || c.targetLang,
        glossaryText: (opts && opts.glossaryText) || '',
        history: (opts && opts.history) || [],
      });
      const res = await fetch(`${c.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${c.apiKey}`,
        },
        body: JSON.stringify({
          model: c.model,
          messages: [
            { role: 'system', content: m.system },
            { role: 'user', content: m.user },
          ],
          temperature: 0.2,
          stream: true,
        }),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok || !res.body) {
        const d = await res.text().catch(() => '');
        throw new Error(`LM Studio API ${res.status}: ${d.slice(0, 200)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const ls = buf.split('\n');
        buf = ls.pop();
        for (const raw of ls) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const delta = j.choices && j.choices[0] && j.choices[0].delta;
            if (delta && typeof delta.content === 'string') {
              full += delta.content;
              if (onPartial) onPartial(full);
            }
          } catch {
            /* ignore */
          }
        }
      }
      return full.trim();
    },
    async translateBatch(lines) {
      if (!lines.length) return [];
      const c = cfg();
      const n = lines.length;
      const numbered = lines.map((raw, i) => `${i + 1}. ${raw}`).join('\n');
      const user =
        `Translate these ${n} lines (${c.sourceLang} -> ${c.targetLang}). ` +
        `Return a JSON array with exactly ${n} strings in the same order. Output ONLY the JSON array.\n` +
        numbered;
      const res = await fetch(`${c.apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
        body: JSON.stringify({
          model: c.model,
          messages: [{ role: 'system', content: 'You are a game localization translator. Output only the JSON array.' }, { role: 'user', content: user }],
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(240000),
      });
      if (!res.ok) {
        const d = await res.text().catch(() => '');
        throw new Error(`LM Studio API ${res.status}: ${d.slice(0, 200)}`);
      }
      const j = await res.json();
      const t = j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : null;
      if (t == null || String(t).trim() === '') throw new Error('LM Studio 返回为空');
      const arr = extractJsonArray(String(t).trim());
      if (!Array.isArray(arr)) throw new Error('返回内容里没有可解析的 JSON 数组');
      return arr.map((v) => (typeof v === 'string' ? v.trim() : ''));
    },
  };
}

module.exports = { createLmStudioProvider };
