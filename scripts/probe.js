const STEP = 100_000_000; // window size; the result is a multiple of this
const SAMPLES = 60; // random IDs per window; a fully live window (~20% density) reads empty ~1e-6 of the time,
// but the window the frontier only partly covers can read empty, so results are accurate to about one STEP
const TIMEOUT_MS = 15_000;

const logEl = document.getElementById('log');
const log = (msg) => { logEl.textContent += `\n${msg}`; };

// Same test as app.js: a live track has a title, a dead one comes back empty or times out.
const isLive = (id) => new Promise((resolve) => {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://api.soundcloud.com/tracks/${id}`)}`;
  document.body.append(frame);
  const done = (live) => { clearTimeout(timer); frame.remove(); resolve(live); };
  const timer = setTimeout(() => done(false), TIMEOUT_MS);
  SC.Widget(frame).bind(SC.Widget.Events.READY, () => {
    SC.Widget(frame).getCurrentSound((sound) => done(Boolean(sound?.title)));
  });
});

const windowLive = async (start) => {
  const ids = Array.from({ length: SAMPLES }, () => start + Math.floor(Math.random() * STEP));
  const results = await Promise.all(ids.map(isLive));
  return results.filter(Boolean).length;
};

const report = (result) => fetch('/result', { method: 'POST', body: JSON.stringify(result) });

try {
  const { max } = await (await fetch('/current')).json();
  // Start one window below the current max to confirm the probe works, then walk up
  // until a window has no live tracks. The frontier is the start of that empty window.
  let start = Math.floor(max / STEP) * STEP - STEP;
  for (let first = true; ; first = false, start += STEP) {
    const live = await windowLive(start);
    log(`${start.toLocaleString()} - ${(start + STEP).toLocaleString()}: ${live}/${SAMPLES} live`);
    if (live > 0) continue;
    if (first) {
      await report({ error: 'no live tracks found below the current MAX_ID; check your connection' });
      log('Failed: no live tracks found below the current MAX_ID. Check your connection.');
    } else {
      await report({ frontier: start });
      log(`Done. Frontier: ${start.toLocaleString()}. You can close this tab.`);
    }
    break;
  }
} catch (e) {
  log(`Failed: ${e.message}`);
}
