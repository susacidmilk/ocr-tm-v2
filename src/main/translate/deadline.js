// Hard deadline wrapper for a promise. If it doesn't settle within ms, reject so
// a hanging network call cannot stall the queue forever.

function withDeadline(promise, ms, note) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(note || '操作超时')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

module.exports = { withDeadline };
