// Rest / work timer. Based on an absolute end timestamp (not a counting interval),
// so it stays correct when the phone sleeps or the tab is throttled.
import { h, iconBtn, fmtDuration } from './ui.js';
import { S } from './store.js';

const KEY = 'fit.timer';
let state = null; // {mode:'rest'|'work', endsAt, duration, label, onDone?}
let tickHandle = null;
let bar = null;
let audio = null;
let warned = false;
let lastBeepSecond = null;
let wakeLock = null;

// ---------------------------------------------------------------- sound & vibration

/** Must be called from a user gesture once, so mobile browsers allow audio later. */
export function unlockAudio() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
  }
  if (audio && audio.state === 'suspended') audio.resume();
}

function beep(freq = 880, ms = 150, when = 0) {
  if (!S.settings.sound || !audio) return;
  const t = audio.currentTime + when;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.05);
}

function vibrate(pattern) {
  if (S.settings.vibrate && navigator.vibrate) navigator.vibrate(pattern);
}

async function notify(title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, tag: 'fit-timer', renotify: true, vibrate: [300, 100, 300], icon: 'icons/icon-192.png' });
  } catch {}
}

// ---------------------------------------------------------------- wake lock

export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.active) keepAwake(true);
    tick();
  }
});

// ---------------------------------------------------------------- timer core

export function startTimer(seconds, { mode = 'rest', label = 'Rust', onDone } = {}) {
  if (!seconds || seconds <= 0) return;
  unlockAudio();
  state = { mode, endsAt: Date.now() + seconds * 1000, duration: seconds, label, onDone };
  warned = false;
  lastBeepSecond = null;
  persist();
  ensureBar();
  if (!tickHandle) tickHandle = setInterval(tick, 200);
  tick();
}

export function adjustTimer(delta) {
  if (!state) return;
  state.endsAt += delta * 1000;
  state.duration = Math.max(1, state.duration + delta);
  if ((state.endsAt - Date.now()) / 1000 > 10) warned = false;
  persist();
  tick();
}

export function stopTimer(finished = false) {
  const s = state;
  state = null;
  persist();
  clearInterval(tickHandle);
  tickHandle = null;
  renderBar();
  if (finished && s?.onDone) s.onDone();
}

export function timerRunning() {
  return !!state;
}

function persist() {
  // Only rest timers survive a reload (work timers have a callback that can't be stored).
  if (state && state.mode === 'rest') localStorage.setItem(KEY, JSON.stringify({ ...state, onDone: undefined }));
  else localStorage.removeItem(KEY);
}

export function restoreTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.endsAt > Date.now()) {
      state = saved;
      ensureBar();
      tickHandle = setInterval(tick, 200);
      tick();
    } else localStorage.removeItem(KEY);
  } catch {}
}

function tick() {
  if (!state) return;
  const left = (state.endsAt - Date.now()) / 1000;
  const whole = Math.ceil(left);
  if (left <= 0) {
    beep(660, 180, 0); beep(880, 180, 0.22); beep(1100, 350, 0.44);
    vibrate([400, 120, 400]);
    notify(state.mode === 'rest' ? 'Rust voorbij' : 'Tijd!', state.mode === 'rest' ? 'Tijd voor je volgende set 💪' : state.label);
    stopTimer(true);
    return;
  }
  if (state.mode === 'rest' && !warned && left <= 10 && state.duration > 20) {
    warned = true;
    beep(600, 120);
    vibrate(120);
  }
  if (whole <= 3 && whole !== lastBeepSecond) {
    lastBeepSecond = whole;
    beep(520, 90);
  }
  renderBar(left);
}

// ---------------------------------------------------------------- UI bar
// Built once and updated in place, so buttons stay tappable while the timer ticks.

let els = null;

function ensureBar() {
  if (bar) return;
  els = {
    fill: h('div.timer-fill'),
    label: h('div.timer-label'),
    time: h('div.timer-time'),
    skip: iconBtn('x', 'Overslaan', () => stopTimer(state?.mode === 'work')),
  };
  bar = h('div.timer-bar', { role: 'timer', 'aria-live': 'off' },
    h('div.timer-progress', els.fill),
    h('div.timer-content',
      els.label,
      els.time,
      h('div.timer-actions',
        h('button.btn.small.ghost', { type: 'button', onclick: () => adjustTimer(-15) }, '−15'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => adjustTimer(15) }, '+15'),
        els.skip)));
  document.body.append(bar);
}

function renderBar(left) {
  if (!bar) return;
  if (!state) {
    bar.classList.remove('show');
    document.body.classList.remove('has-timer');
    return;
  }
  els.fill.style.width = Math.max(0, Math.min(100, (1 - left / state.duration) * 100)) + '%';
  els.label.textContent = state.label;
  els.time.textContent = fmtDuration(Math.ceil(left));
  els.time.classList.toggle('soon', left <= 10);
  bar.classList.toggle('work', state.mode === 'work');
  bar.classList.add('show');
  document.body.classList.add('has-timer');
}
