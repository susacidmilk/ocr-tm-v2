// Batch recorder: an ordered, de-duplicated list of raw dialogue lines being
// captured for later batch translation. Pure state machine (no OCR dependency).

const REC_STATE = Object.freeze({
  IDLE: 'idle',
  RECORDING: 'recording',
  RECORDED: 'recorded', // stopped, ready to translate
  TRANSLATING: 'translating',
  DONE: 'done',
});

function createRecorder({ isKnown, onEvent }) {
  let state = REC_STATE.IDLE;
  let pending = []; // ordered unique raw lines this session
  const seen = new Set(); // norm strings already in pending

  function emit() {
    if (onEvent) onEvent({ state, count: pending.length, lines: pending.slice() });
  }

  function setState(s) {
    state = s;
    emit();
  }

  return {
    REC_STATE,
    getState() {
      return { state, count: pending.length };
    },
    list() {
      return pending.slice();
    },
    start() {
      if (state === REC_STATE.TRANSLATING) return { ok: false, reason: 'translating' };
      setState(REC_STATE.RECORDING);
      return { ok: true };
    },
    stop() {
      if (state === REC_STATE.RECORDING) setState(REC_STATE.RECORDED);
      return { ok: true };
    },
    reset() {
      pending = [];
      seen.clear();
      setState(REC_STATE.IDLE);
      return { ok: true };
    },
    // Called by the OCR router when a line is seen while recording.
    add(raw) {
      if (state !== REC_STATE.RECORDING) return { added: false, reason: 'not-recording' };
      const norm = this.normOf ? this.normOf(raw) : raw;
      // skip if already in pending or already known (TM/seen earlier)
      if (seen.has(norm) || (isKnown && isKnown(norm))) {
        return { added: false, reason: 'duplicate' };
      }
      pending.push(raw);
      seen.add(norm);
      emit();
      return { added: true };
    },
    removeAt(i) {
      if (i >= 0 && i < pending.length) {
        const norm = this.normOf ? this.normOf(pending[i]) : pending[i];
        seen.delete(norm);
        pending.splice(i, 1);
        emit();
      }
    },
    editAt(i, raw) {
      if (i >= 0 && i < pending.length && raw && raw.trim()) {
        const oldNorm = this.normOf ? this.normOf(pending[i]) : pending[i];
        const newNorm = this.normOf ? this.normOf(raw) : raw;
        if (oldNorm === newNorm) pending[i] = raw;
        else {
          if (seen.has(newNorm)) return; // would collide
          seen.delete(oldNorm);
          pending[i] = raw;
          seen.add(newNorm);
        }
        emit();
      }
    },
    markTranslating() {
      setState(REC_STATE.TRANSLATING);
    },
    markDone() {
      pending = [];
      seen.clear();
      setState(REC_STATE.DONE);
    },
  };
}

module.exports = { createRecorder, REC_STATE };
