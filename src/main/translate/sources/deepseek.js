// DeepSeek provider (OpenAI-compatible /chat/completions).
// - translateLine: streaming single line.
// - translateBatch: one non-streaming request returning a JSON array of exactly
//   N translations aligned to the numbered input lines.

const { SOURCES } = require('../../../shared/constants');

function cfgBundle(bundle, settings) {
  return {
    apiKey: bundle.apiKey,
    apiBase: (bundle.apiBase || 'https://api.deepseek.com').trim().replace(/\/+$/, ''),
    model: bundle.model || 'deepseek-chat',
    sourceLang: settings.sourceLang || 'English',
    targetLang: settings.targetLang || 'Simplified Chinese',
    // Lower temperature improves deterministic alignment / reduces "echo input"
    // behaviour. Batch path uses 0 by default.
    batchTemperature: Number.isFinite(Number(settings.tmBatchTemperature))
      ? Number(settings.tmBatchTemperature)
      : 0,
    // Reasoning effort to send at the TOP level of the request body.
    // 'off' -> omit the field entirely; 'low'/'high' -> {"reasoning_effort": ...}
    reasoningEffort: settings.tmReasoningEffort === 'low' || settings.tmReasoningEffort === 'high'
      ? settings.tmReasoningEffort
      : null,
  };
}

// attach top-level reasoning_effort if configured
function withReasoningEffort(body, cfg) {
  if (cfg && cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;
  return body;
}

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}

// ---- Single-line (streaming) -------------------------------------------------

function buildLineMessages(line, cfg, glossaryText) {
  const msgs = [];
  let sys = `You are a professional game localization translator. ` +
    `Translate the following ${cfg.sourceLang} dialogue into ${cfg.targetLang}. ` +
    `Keep person and place names as-is. Output only the translation, no explanation.`;
  if (glossaryText) sys += `\nTerminology constraints:\n${glossaryText}`;
  msgs.push({ role: 'system', content: sys });
  msgs.push({ role: 'user', content: line });
  return msgs;
}

async function streamChat(messages, cfg, onPartial) {
  const res = await fetch(`${cfg.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(withReasoningEffort({ model: cfg.model, messages, temperature: 0.3, stream: true }, cfg)),
    signal: timeoutSignal(120000),
  });
  if (!res.ok || !res.body) {
    const d = await res.text().catch(() => '');
    throw new Error(`DeepSeek API ${res.status}: ${d.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const rawLine of lines) {
      const line = rawLine.trim();
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
        /* ignore partial parse noise */
      }
    }
  }
  return full.trim();
}

// ---- Batch (numbered lines -> JSON array) ------------------------------------

function buildBatchUser(lines, cfg) {
  const n = lines.length;
  const numbered = lines.map((raw, i) => `${i + 1}. ${raw}`).join('\n');
  return (
    `Translate the following ${n} game dialogue lines (${cfg.sourceLang} -> ${cfg.targetLang}).\n` +
    `Rules:\n` +
    `1) Return EXACTLY one JSON array with EXACTLY ${n} string elements, in the same order as the numbered lines below.\n` +
    `2) Element at index i is the translation of numbered line i+1. Do NOT merge, split, drop or reorder lines.\n` +
    `3) Even if a line should stay as-is (onomatopoeia, exclamation, a name to keep), return one element for it.\n` +
    `4) Keep person/place/proper names as-is.\n` +
    `5) Output ONLY the JSON array; no prose, no surrounding explanation.\n\n` +
    numbered
  );
}

function buildBatchSystem(cfg, glossaryText) {
  let sys = `You are a professional game localization translator. Your output must be ONLY a JSON array.`;
  if (glossaryText) sys += `\nTerminology constraints:\n${glossaryText}`;
  return sys;
}

async function callBatchOnce(lines, cfg, glossaryText) {
  const messages = [
    { role: 'system', content: buildBatchSystem(cfg, glossaryText) },
    { role: 'user', content: buildBatchUser(lines, cfg) },
  ];
  const res = await fetch(`${cfg.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(withReasoningEffort({ model: cfg.model, messages, temperature: cfg.batchTemperature, stream: false }, cfg)),
    signal: timeoutSignal(180000),
  });
  if (!res.ok) {
    const d = await res.text().catch(() => '');
    throw new Error(`DeepSeek API ${res.status}: ${d.slice(0, 200)}`);
  }
  const j = await res.json();
  const t =
    j && j.choices && j.choices[0] && j.choices[0].message
      ? j.choices[0].message.content
      : null;
  if (t == null || String(t).trim() === '') throw new Error('DeepSeek 返回为空');
  return String(t).trim();
}

// Robustly extract the first top-level JSON array from a (possibly wrapped) reply.
function extractJsonArray(text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Default provider (DeepSeek only; LM Studio added later on same interface).
function createDeepSeekProvider(bundle, settings) {
  const cfg = () => cfgBundle(bundle, settings);
  return {
    key: SOURCES.DEEPSEEK,
    label: 'DeepSeek',
    supportsStreaming: true,
    async translateLine(line, { onPartial, glossaryText } = {}) {
      const c = cfg();
      return streamChat(buildLineMessages(line, c, glossaryText), c, onPartial);
    },
    // Returns array aligned to `lines`, or throws if unparseable. Caller handles
    // length mismatch via retry/bisection.
    async translateBatch(lines, { glossaryText } = {}) {
      if (!lines.length) return [];
      const c = cfg();
      const text = await callBatchOnce(lines, c, glossaryText);
      const arr = extractJsonArray(text);
      if (!Array.isArray(arr)) {
        throw new Error('返回内容里没有可解析的 JSON 数组');
      }
      return arr.map((v) => (typeof v === 'string' ? v.trim() : ''));
    },
  };
}

module.exports = { createDeepSeekProvider, extractJsonArray, cfgBundle };
