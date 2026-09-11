// Typewriter stabilizer: only commit a line once it has appeared unchanged for
// N consecutive OCR frames, and only re-commit an identical line after it has
// actually left the screen (departed). Prevents half-lines and endless repeats.

function createStabilizer({ stableFrames }) {
  let currentText = '';
  let stableCount = 0;
  let lastCommittedRaw = '';
  let departed = false;

  function handle(text) {
    const clean = String(text || '').trim();
    if (!clean) {
      if (currentText) departed = true;
      currentText = '';
      stableCount = 0;
      return { commit: null };
    }
    if (clean === currentText) {
      stableCount += 1;
      const sameAsLast = clean === lastCommittedRaw;
      if (stableCount >= stableFrames && (!sameAsLast || departed)) {
        lastCommittedRaw = clean;
        departed = false; // consumed this line; only re-commit after it leaves
        return { commit: clean };
      }
    } else {
      currentText = clean;
      stableCount = 1;
      departed = true; // content changed -> previous line left the screen
    }
    return { commit: null };
  }

  function reset() {
    currentText = '';
    stableCount = 0;
    lastCommittedRaw = '';
    departed = false;
  }

  return { handle, reset, _state: () => ({ currentText, stableCount, lastCommittedRaw, departed }) };
}

module.exports = { createStabilizer };
