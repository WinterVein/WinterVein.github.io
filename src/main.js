import './style.css';

/* =====================================================================
   HOW THIS SURVIVES SLEEP / THROTTLED TABS
   ---------------------------------------------------------------------
   A browser tab cannot run JavaScript while the computer is actually
   asleep — no page, service worker, or timer can execute during system
   suspend. What this file does instead is never trust elapsed-tick
   counting. Every timer only stores a wall-clock `startedAt` timestamp
   plus an `accumulatedSec` bank. The displayed time is always
   `accumulated + (Date.now() - startedAt)`, recomputed from scratch on
   every render. So the moment your laptop wakes and the page repaints,
   it instantly shows the *correct* elapsed time and current Pomodoro
   phase — as if it had been running the whole time — even though no
   code executed while it was asleep. State is also persisted to
   localStorage so a refresh or an accidental tab close doesn't lose
   your place.
===================================================================== */

const LS_LEFT = 'studyTimer.left.v1';
const LS_RIGHT = 'studyTimer.right.v1';

const fmt = (totalSeconds, forceHours = false) => {
  totalSeconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0 || forceHours) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
};

let audioCtx;
function chime(freqs = [880, 1320]) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, now + i * 0.16);
      gain.gain.linearRampToValueAtTime(0.14, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.4);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.42);
    });
  } catch (e) { /* audio unavailable, ignore */ }
}

let notifyPermissionAsked = false;
function notify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, silent: true }); } catch (e) {}
  } else if (Notification.permission !== 'denied' && !notifyPermissionAsked) {
    notifyPermissionAsked = true;
    Notification.requestPermission();
  }
}

function saveState(key, state) {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
}
function loadState(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch (e) { return fallback; }
}

/* =========================================================
   LEFT — total study session
   ========================================================= */
(function leftTimer() {
  const digits = document.getElementById('leftDigits');
  const sub = document.getElementById('leftSub');
  const fill = document.getElementById('leftFill');
  const startBtn = document.getElementById('leftStart');
  const pauseBtn = document.getElementById('leftPause');
  const resetBtn = document.getElementById('leftReset');
  const hoursInput = document.getElementById('hoursInput');
  const minsInput = document.getElementById('minsInput');
  const unlimitedToggle = document.getElementById('unlimitedToggle');
  const setup = document.getElementById('leftSetup');
  const blockStartInput = document.getElementById('blockStart');
  const blockEndInput = document.getElementById('blockEnd');
  const addBlockBtn = document.getElementById('addBlock');
  const blocksList = document.getElementById('blocksList');
  const blocksSetup = document.getElementById('blocksSetup');

  let state = loadState(LS_LEFT, {
    targetSec: 2 * 3600,
    unlimited: false,
    startedAt: null,     // epoch ms, or null if paused
    accumulatedSec: 0,   // banked seconds before the current run
    running: false,
    done: false,
    studyBlocks: [],     // [{ start: hoursFromStart, end: hoursFromStart }]
  });
  if (!Array.isArray(state.studyBlocks)) state.studyBlocks = [];

  hoursInput.value = Math.floor(state.targetSec / 3600);
  minsInput.value = Math.floor((state.targetSec % 3600) / 60);
  unlimitedToggle.checked = state.unlimited;

  function elapsed() {
    return state.accumulatedSec + (state.running && state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0);
  }

  function renderBlocksList() {
    blocksList.innerHTML = '';
    state.studyBlocks
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((block) => {
        const chip = document.createElement('div');
        chip.className = 'block-chip';
        const fmtH = (h) => (Number.isInteger(h) ? h : h.toFixed(1));
        chip.innerHTML = `<span>${fmtH(block.start)}h – ${fmtH(block.end)}h</span>`;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', `Remove ${fmtH(block.start)}–${fmtH(block.end)} block`);
        removeBtn.addEventListener('click', () => {
          state.studyBlocks = state.studyBlocks.filter((b) => b !== block);
          saveState(LS_LEFT, state);
          renderBlocksList();
          drawRuler();
        });
        chip.appendChild(removeBtn);
        blocksList.appendChild(chip);
      });
  }

  addBlockBtn.addEventListener('click', () => {
    const start = parseFloat(blockStartInput.value);
    const end = parseFloat(blockEndInput.value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) return;
    state.studyBlocks.push({ start, end });
    saveState(LS_LEFT, state);
    renderBlocksList();
    drawRuler();
    blockStartInput.value = '';
    blockEndInput.value = '';
    blockStartInput.focus();
  });

  [blockStartInput, blockEndInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBlockBtn.click();
    });
  });

  function readTarget() {
    const h = Math.max(0, Math.min(999, parseInt(hoursInput.value) || 0));
    const m = Math.max(0, Math.min(59, parseInt(minsInput.value) || 0));
    state.targetSec = h * 3600 + m * 60;
    state.unlimited = unlimitedToggle.checked;
    if (!state.unlimited && state.targetSec <= 0) state.targetSec = 60;
  }

  function setSetupLocked(locked) {
    hoursInput.disabled = locked || state.unlimited;
    minsInput.disabled = locked || state.unlimited;
    unlimitedToggle.disabled = locked;
    setup.style.opacity = locked ? 0.45 : 1;
  }

  function render() {
    const el = elapsed();

    if (state.unlimited) {
      digits.textContent = fmt(el, true);
      fill.style.width = '100%';
      fill.style.opacity = state.running ? '0.55' : '0.3';
      sub.textContent = state.running ? 'Counting up · no limit set' : (el > 0 ? 'Paused' : 'Set a target, then start.');
    } else {
      const remaining = Math.max(0, state.targetSec - el);

      if (remaining <= 0 && state.running && !state.done) {
        state.done = true;
        state.running = false;
        state.accumulatedSec = state.targetSec;
        state.startedAt = null;
        startBtn.textContent = 'Restart';
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        chime([660, 990, 660]);
        notify('Study session complete', 'Your target study time has ended.');
        setSetupLocked(false);
        saveState(LS_LEFT, state);
      }

      digits.textContent = fmt(state.done ? 0 : remaining, state.targetSec >= 3600);
      const pct = state.targetSec > 0 ? Math.min(100, (el / state.targetSec) * 100) : 0;
      fill.style.width = pct + '%';
      fill.style.opacity = '1';
      sub.textContent = state.done
        ? 'Session complete — nice work.'
        : (state.running ? 'Studying…' : (el > 0 ? 'Paused' : 'Set a target, then start.'));
    }

    document.title = (state.running ? '● ' : '') +
      (state.unlimited ? fmt(el, true) : fmt(Math.max(0, state.targetSec - el))) + ' — Study';

    drawRuler();
  }

  startBtn.addEventListener('click', () => {
    if (state.done) {
      state.done = false;
      state.accumulatedSec = 0;
    }
    readTarget();
    state.running = true;
    state.startedAt = Date.now();
    startBtn.textContent = 'Running…';
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    setSetupLocked(true);
    saveState(LS_LEFT, state);
    render();
  });

  pauseBtn.addEventListener('click', () => {
    state.accumulatedSec = elapsed();
    state.running = false;
    state.startedAt = null;
    startBtn.textContent = 'Resume';
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    setSetupLocked(false);
    saveState(LS_LEFT, state);
    render();
  });

  resetBtn.addEventListener('click', () => {
    state.running = false;
    state.done = false;
    state.accumulatedSec = 0;
    state.startedAt = null;
    startBtn.textContent = 'Start';
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    setSetupLocked(false);
    readTarget();
    saveState(LS_LEFT, state);
    render();
  });

  [hoursInput, minsInput, unlimitedToggle].forEach((el) => {
    el.addEventListener('change', () => {
      if (!state.running) {
        readTarget();
        setSetupLocked(false);
        saveState(LS_LEFT, state);
        render();
      }
    });
  });

  setSetupLocked(state.running);
  if (state.running) { startBtn.textContent = 'Running…'; startBtn.disabled = true; pauseBtn.disabled = false; }
  renderBlocksList();
  render();

  window.__leftRender = render;
})();

/* =========================================================
   RIGHT — continuous pomodoro (adjustable focus/break, loops)
   ========================================================= */
(function rightTimer() {
  const digits = document.getElementById('rightDigits');
  const sub = document.getElementById('rightSub');
  const fill = document.getElementById('rightFill');
  const startBtn = document.getElementById('rightStart');
  const pauseBtn = document.getElementById('rightPause');
  const resetBtn = document.getElementById('rightReset');
  const phaseLabel = document.getElementById('phaseLabel');
  const cycleTag = document.getElementById('cycleTag');
  const panel = document.getElementById('rightPanel');
  const title = document.getElementById('rightTitle');
  const focusInput = document.getElementById('focusInput');
  const breakInput = document.getElementById('breakInput');
  const setup = document.getElementById('rightSetup');

  let state = loadState(LS_RIGHT, {
    focusSec: 45 * 60,
    breakSec: 5 * 60,
    startedAt: null,
    accumulatedSec: 0,
    running: false,
    lastPhase: 'focus',
    windowElapsedAtStart: null, // in-window seconds banked at last (auto-)start, when window mode is active
    autoStarted: false,         // true if the current run was started automatically by window mode
  });

  focusInput.value = Math.round(state.focusSec / 60);
  breakInput.value = Math.round(state.breakSec / 60);

  function cycleSec() { return state.focusSec + state.breakSec; }

  function getLeftWindows() {
    const leftState = loadState(LS_LEFT, { targetSec: 0, unlimited: true, studyBlocks: [], accumulatedSec: 0, running: false, startedAt: null });
    const leftElapsed = leftState.accumulatedSec + (leftState.running && leftState.startedAt ? (Date.now() - leftState.startedAt) / 1000 : 0);
    const blocks = Array.isArray(leftState.studyBlocks) ? leftState.studyBlocks : [];
    return { leftState, leftElapsed, blocks };
  }

  // Total in-window seconds elapsed so far on the left session's own
  // clock. Returns null if no study windows are defined at all, which
  // signals "window mode is off" — Pomodoro behaves as plain continuous.
  function inWindowElapsedSeconds(leftElapsedSec, blocks) {
    if (!blocks || blocks.length === 0) return null;
    const leftElapsedH = leftElapsedSec / 3600;
    let total = 0;
    blocks.slice().sort((a, b) => a.start - b.start).forEach((b) => {
      if (leftElapsedH > b.start) total += (Math.min(leftElapsedH, b.end) - b.start) * 3600;
    });
    return Math.max(0, total);
  }

  function currentlyInsideWindow(leftElapsedSec, blocks) {
    if (!blocks || blocks.length === 0) return null; // null = window mode off
    const h = leftElapsedSec / 3600;
    return blocks.some((b) => h >= b.start && h < b.end);
  }

  function elapsed() {
    const { leftElapsed, blocks } = getLeftWindows();
    const windowElapsed = inWindowElapsedSeconds(leftElapsed, blocks);

    if (windowElapsed === null) {
      // No study windows defined — normal continuous behavior.
      return state.accumulatedSec + (state.running && state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0);
    }
    // Window mode: only in-window time counts. Because this is derived
    // from the left session's own in-window total (not wall clock), it
    // self-corrects across sleep/pause exactly like the rest of the app.
    if (state.running && state.windowElapsedAtStart != null) {
      return state.accumulatedSec + Math.max(0, windowElapsed - state.windowElapsedAtStart);
    }
    return state.accumulatedSec;
  }

  function readDurations() {
    const f = Math.max(1, Math.min(180, parseInt(focusInput.value) || 45));
    const b = Math.max(1, Math.min(60, parseInt(breakInput.value) || 5));
    state.focusSec = f * 60;
    state.breakSec = b * 60;
    title.textContent = `Pomodoro cycle · ${f} / ${b}`;
  }

  function setSetupLocked(locked) {
    focusInput.disabled = locked;
    breakInput.disabled = locked;
    setup.style.opacity = locked ? 0.45 : 1;
  }

  function render() {
    const { leftState, leftElapsed, blocks } = getLeftWindows();
    const windowElapsed = inWindowElapsedSeconds(leftElapsed, blocks);
    const insideWindow = currentlyInsideWindow(leftElapsed, blocks); // null | true | false

    // --- Auto-start / auto-pause when study windows are in use ---
    if (insideWindow !== null) {
      if (insideWindow && !state.running) {
        state.running = true;
        state.startedAt = Date.now();
        state.windowElapsedAtStart = windowElapsed;
        state.autoStarted = true;
        startBtn.textContent = 'Running…';
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        setSetupLocked(true);
        sub.textContent = 'Auto-started — inside a study window.';
        saveState(LS_RIGHT, state);
      } else if (!insideWindow && state.running && state.autoStarted) {
        // Bank progress and freeze the clock until the next window.
        state.accumulatedSec = elapsed();
        state.running = false;
        state.startedAt = null;
        state.windowElapsedAtStart = null;
        startBtn.textContent = 'Resume';
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        setSetupLocked(false);
        saveState(LS_RIGHT, state);
      }
    }

    const el = elapsed();
    const cSec = cycleSec();
    const cycleIndex = Math.floor(el / cSec);
    const elapsedInCycle = el - cycleIndex * cSec;
    const isBreak = elapsedInCycle >= state.focusSec;
    const phase = isBreak ? 'break' : 'focus';
    // Completed pomodoros = every full cycle finished, plus the current
    // one if its focus block is already done (i.e. we're now on break).
    const completed = cycleIndex + (isBreak ? 1 : 0);

    if (state.running && phase !== state.lastPhase) {
      chime(isBreak ? [880, 660] : [660, 880, 1320]);
      notify(isBreak ? 'Break time' : 'Back to focus', isBreak ? 'Step away for a few minutes.' : 'Focus block has started.');
      state.lastPhase = phase;
      saveState(LS_RIGHT, state);
    }

    // How many more full pomodoros can still fit before the left
    // session ends. In window mode this uses remaining in-window time;
    // otherwise it uses raw remaining wall-clock time.
    let remainingText = '';
    if (!leftState.unlimited && leftState.targetSec > 0) {
      let timeLeftForPomodoros;
      if (windowElapsed !== null) {
        const totalWindowSec = blocks.reduce((sum, b) => sum + Math.max(0, (b.end - b.start)) * 3600, 0);
        timeLeftForPomodoros = totalWindowSec - windowElapsed;
      } else {
        timeLeftForPomodoros = leftState.targetSec - leftElapsed;
      }
      remainingText = ` · ${Math.max(0, Math.floor(timeLeftForPomodoros / cSec))} left before session ends`;
    }

    panel.classList.toggle('is-break', isBreak);
    phaseLabel.textContent = isBreak ? 'Break' : 'Focus';

    const phaseTotal = isBreak ? state.breakSec : state.focusSec;
    const phaseElapsed = isBreak ? elapsedInCycle - state.focusSec : elapsedInCycle;
    const remaining = phaseTotal - phaseElapsed;

    digits.textContent = fmt(remaining);
    fill.style.width = Math.min(100, (phaseElapsed / phaseTotal) * 100) + '%';
    if (insideWindow === false && !state.running) {
      sub.textContent = 'Outside study window — paused.';
    } else {
      sub.textContent = state.running
        ? (isBreak ? 'Step away — back to it soon.' : 'Heads down.')
        : (el > 0 ? 'Paused' : (insideWindow === null ? 'Runs continuously until you pause it.' : 'Waiting for your next study window.'));
    }
    cycleTag.textContent = `${completed} completed${remainingText}`;

    document.title = (state.running ? '● ' : '') + fmt(remaining) + ' ' + (isBreak ? 'Break' : 'Focus') + ' — Pomodoro';

    drawRuler();
  }

  startBtn.addEventListener('click', () => {
    if (Notification && Notification.permission === 'default') Notification.requestPermission();
    if (state.accumulatedSec === 0 && !state.startedAt) readDurations();
    const { leftElapsed, blocks } = getLeftWindows();
    const windowElapsed = inWindowElapsedSeconds(leftElapsed, blocks);
    state.running = true;
    state.startedAt = Date.now();
    state.windowElapsedAtStart = windowElapsed;
    state.autoStarted = false;
    startBtn.textContent = 'Running…';
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    setSetupLocked(true);
    saveState(LS_RIGHT, state);
    render();
  });

  pauseBtn.addEventListener('click', () => {
    state.accumulatedSec = elapsed();
    state.running = false;
    state.startedAt = null;
    state.windowElapsedAtStart = null;
    state.autoStarted = false;
    startBtn.textContent = 'Resume';
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    setSetupLocked(false);
    saveState(LS_RIGHT, state);
    render();
  });

  resetBtn.addEventListener('click', () => {
    state.running = false;
    state.accumulatedSec = 0;
    state.startedAt = null;
    state.windowElapsedAtStart = null;
    state.autoStarted = false;
    state.lastPhase = 'focus';
    startBtn.textContent = 'Start';
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    panel.classList.remove('is-break');
    setSetupLocked(false);
    saveState(LS_RIGHT, state);
    render();
  });

  [focusInput, breakInput].forEach((el) => {
    el.addEventListener('change', () => {
      if (!state.running) {
        readDurations();
        state.accumulatedSec = 0;
        state.startedAt = null;
        state.lastPhase = 'focus';
        panel.classList.remove('is-break');
        saveState(LS_RIGHT, state);
        render();
      }
    });
  });

  readDurations();
  setSetupLocked(state.running);
  if (state.running) { startBtn.textContent = 'Running…'; startBtn.disabled = true; pauseBtn.disabled = false; }
  render();

  window.__rightRender = render;
})();

/* =========================================================
   RULER — vertical tick strip between panels
   ========================================================= */
function drawRuler() {
  const rulerScroll = document.getElementById('rulerScroll');
  if (!rulerScroll) return;
  rulerScroll.innerHTML = '';
  const ruler = document.getElementById('ruler');
  const rulerHeight = ruler.clientHeight;
  if (!rulerHeight) return;

  const leftState = loadState(LS_LEFT, { targetSec: 7200, unlimited: false, accumulatedSec: 0, running: false, startedAt: null });
  const leftElapsed = leftState.accumulatedSec + (leftState.running && leftState.startedAt ? (Date.now() - leftState.startedAt) / 1000 : 0);

  const rightState = loadState(LS_RIGHT, { focusSec: 2700, breakSec: 300 });
  const cycleMinutes = Math.max(5, Math.round((rightState.focusSec + rightState.breakSec) / 60));

  const totalMinutes = (!leftState.unlimited && leftState.targetSec > 0)
    ? Math.ceil(leftState.targetSec / 60)
    : Math.max(180, Math.ceil((leftElapsed + 60) / 60));

  const pxPerMin = rulerHeight / totalMinutes;

  // Highlighted study-window bands (drawn first, so ticks sit on top)
  (leftState.studyBlocks || []).forEach((block) => {
    const startMin = Math.max(0, block.start * 60);
    const endMin = Math.min(totalMinutes, block.end * 60);
    if (endMin <= startMin) return;
    const yTop = startMin * pxPerMin;
    const yBottom = endMin * pxPerMin;
    const band = document.createElement('div');
    band.className = 'ruler-band';
    band.style.top = yTop + 'px';
    band.style.height = Math.max(2, yBottom - yTop) + 'px';
    const fmtH = (h) => (Number.isInteger(h) ? h : h.toFixed(1));
    band.title = `Study window: ${fmtH(block.start)}h – ${fmtH(block.end)}h`;
    rulerScroll.appendChild(band);
  });

  for (let min = 0; min <= totalMinutes; min += 5) {
    const y = min * pxPerMin;
    if (y > rulerHeight) break;
    const isCycleBoundary = min % cycleMinutes === 0;
    const tick = document.createElement('div');
    tick.className = 'tick' + (isCycleBoundary ? ' major' : '');
    tick.style.top = y + 'px';
    const line = document.createElement('div');
    line.className = 'line';
    tick.appendChild(line);
    if (isCycleBoundary && min > 0) {
      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = Math.round(min / cycleMinutes);
      num.style.top = (y - 8) + 'px';
      tick.appendChild(num);
    }
    rulerScroll.appendChild(tick);
  }

  if (!leftState.unlimited && leftState.targetSec > 0) {
    const y = Math.min(rulerHeight, (leftElapsed / 60) * pxPerMin);
    const marker = document.createElement('div');
    Object.assign(marker.style, {
      position: 'absolute', left: '50%', transform: 'translate(-50%,-50%)',
      top: y + 'px', width: '10px', height: '10px', borderRadius: '50%',
      background: 'var(--amber)', boxShadow: '0 0 8px rgba(227,178,60,0.7)',
    });
    rulerScroll.appendChild(marker);
  }
}

/* =========================================================
   Global refresh loop + wake/visibility recovery
   ---------------------------------------------------------
   setInterval is used only to repaint the UI, never to accumulate
   time. Because every render recomputes elapsed time from real
   timestamps, a delayed or skipped tick (from sleep, tab throttling,
   etc.) self-corrects on the very next tick. The visibilitychange and
   focus listeners force an immediate repaint the moment the tab wakes
   up, so you see the caught-up state right away instead of waiting
   for the next interval.
===================================================================== */
function renderAll() {
  window.__leftRender && window.__leftRender();
  window.__rightRender && window.__rightRender();
}

setInterval(renderAll, 250);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderAll();
});
window.addEventListener('focus', renderAll);
window.addEventListener('pageshow', renderAll);

window.addEventListener('resize', drawRuler);
