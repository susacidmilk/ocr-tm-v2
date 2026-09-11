// OCR capture: launches ocr-worker.ps1 as a persistent child process and reads
// screen regions via the `C X Y W H` / `@@OCR_BEGIN…@@OCR_END` stdin/stdout
// protocol. Pure Node — depends only on spawn + the path to the ps1 script.

const { spawn } = require('node:child_process');
const path = require('node:path');

const MARK_BEGIN = '@@OCR_BEGIN';
const MARK_END = '@@OCR_END';
const MARK_ERROR = '@@OCR_ERROR';

// Simple injected-fake for tests: a function returning a child-like object.
function createOcrEngine({ ps1Path, spawnOverride } = {}) {
  let worker = null;
  let buffer = '';
  let pending = null; // {resolve, reject, timer}
  let captureChain = Promise.resolve();

  function drain() {
    let begin = buffer.indexOf(MARK_BEGIN);
    while (begin !== -1) {
      const end = buffer.indexOf(MARK_END, begin);
      if (end === -1) return;
      const block = buffer.slice(begin + MARK_BEGIN.length, end);
      buffer = buffer.slice(end + MARK_END.length);
      const lines = block.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const errorLine = lines.find((l) => l.startsWith(MARK_ERROR));
      const text = lines.filter((l) => !l.startsWith(MARK_ERROR)).join('\n').trim();
      const p = pending;
      pending = null;
      if (!p) {
        begin = buffer.indexOf(MARK_BEGIN);
        continue;
      }
      clearTimeout(p.timer);
      if (errorLine) p.reject(new Error(errorLine.slice(MARK_ERROR.length).trim() || 'OCR 识别失败'));
      else p.resolve(text);
      begin = buffer.indexOf(MARK_BEGIN);
    }
  }

  function failPending(err) {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      pending = null;
    }
  }

  function spawnWorker() {
    const script = ps1Path || path.join(__dirname, '..', '..', '..', 'ocr-worker.ps1');
    const child = (spawnOverride && spawnOverride(script)) ||
      spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    worker = child;
    buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      drain();
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {
      failPending(new Error('OCR 进程启动失败'));
      worker = null;
    });
    child.on('close', () => {
      failPending(new Error('OCR 进程意外退出'));
      worker = null;
    });
    return child;
  }

  function kill() {
    const child = worker;
    worker = null;
    buffer = '';
    if (child) {
      try {
        child.stdin.end();
        child.kill();
      } catch {
        /* already gone */
      }
    }
  }

  function perform(physical) {
    return new Promise((resolve, reject) => {
      if (!worker || worker.killed) spawnWorker();
      if (!worker || !worker.stdin.writable) {
        reject(new Error('OCR 进程不可用'));
        return;
      }
      const timer = setTimeout(() => {
        pending = null;
        kill();
        reject(new Error('OCR 超时'));
      }, 15000);
      pending = { resolve, reject, timer };
      worker.stdin.write(`C ${physical.x} ${physical.y} ${physical.width} ${physical.height}\n`);
    });
  }

  function capture(physical) {
    const task = captureChain.then(() => perform(physical));
    captureChain = task.catch(() => {});
    return task;
  }

  return { capture, kill, drain, _killWorker: kill };
}

module.exports = { createOcrEngine };
