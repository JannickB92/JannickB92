// Application state, local cache and derived statistics.
import { api, pendingWorkouts } from './api.js';

export const MUSCLES = {
  borst: 'Borst', rug: 'Rug', schouders: 'Schouders', biceps: 'Biceps', triceps: 'Triceps',
  quadriceps: 'Bovenbenen (voor)', hamstrings: 'Hamstrings', billen: 'Billen', kuiten: 'Kuiten',
  core: 'Core', onderrug: 'Onderrug', onderarmen: 'Onderarmen', heupen: 'Heupen', conditie: 'Conditie',
};

export const EQUIPMENT = {
  barbell: 'Halterstang', dumbbell: 'Dumbbells', kettlebell: 'Kettlebell', cable: 'Kabelstation',
  machine: 'Machines', bar: 'Optrek-/dipstang', box: 'Box / bankje', ball: 'Medicine ball', bodyweight: 'Eigen gewicht',
};

export const PATTERNS = {
  squat: 'Squat', hinge: 'Heupscharnier', lunge: 'Lunge / eenbenig', push_h: 'Duwen horizontaal',
  push_v: 'Duwen verticaal', pull_h: 'Trekken horizontaal', pull_v: 'Trekken verticaal',
  shoulders: 'Schouders', chest_iso: 'Borst (isolatie)', biceps: 'Biceps', triceps: 'Triceps',
  legs_iso: 'Benen (isolatie)', glutes: 'Billen', calves: 'Kuiten', core: 'Core', power: 'Explosief',
  carry: 'Dragen', conditioning: 'Conditie', warmup: 'Warming-up', stretch: 'Stretchen', other: 'Overig',
};

export const GOALS = { kracht: 'Kracht', spiermassa: 'Spiermassa', atletisch: 'Fit & atletisch' };

export const DEFAULT_SETTINGS = {
  equipment: ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bar', 'box'],
  goal: 'spiermassa',
  minutes: 45,
  focus: 'auto',
  autoRest: true,
  sound: true,
  vibrate: true,
  warmup: true,
  cooldown: true,
  barWeight: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};

export const S = {
  catalog: [],
  byId: {},
  user: null,
  settings: { ...DEFAULT_SETTINGS },
  workouts: [],
  templates: [],
  custom: [],
  body: [],
  photos: [],
  offline: false,
  active: null,
  draft: null,
};

const CACHE_KEY = 'fit.cache';
const ACTIVE_KEY = 'fit.active';

export async function loadCatalog() {
  const res = await fetch('data/exercises.json');
  S.catalog = await res.json();
  indexCatalog();
}

function indexCatalog() {
  S.byId = {};
  for (const ex of S.catalog) S.byId[ex.id] = ex;
  for (const ex of S.custom) S.byId[ex.id] = ex;
}

export function allExercises() {
  return [...S.catalog, ...S.custom];
}

export function exercise(id) {
  return S.byId[id] || { id, name: id, pattern: 'other', muscles: [], equip: [], type: 'reps', reps: 10, rest: 90, inc: 2.5, tips: [], missing: true };
}

export function imageUrl(ex, i = 0) {
  return ex.custom || ex.missing ? null : `img/ex/${ex.id}/${i}.jpg`;
}

export function applySync(data) {
  S.user = data.user;
  S.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  S.workouts = data.workouts || [];
  S.templates = data.templates || [];
  S.custom = data.custom || [];
  S.body = data.body || [];
  S.photos = data.photos || [];
  indexCatalog();
  mergePending();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage full: the app keeps working online.
  }
}

/** Workouts saved offline (still in the outbox) are shown as if they were stored. */
function mergePending() {
  const known = new Set(S.workouts.map((w) => w.uid));
  for (const w of pendingWorkouts()) {
    if (!known.has(w.uid)) S.workouts.push({ ...w, pending: true });
  }
  S.workouts.sort((a, b) => a.started_at - b.started_at);
}

export function loadCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (data) {
      applySync(data);
      return true;
    }
  } catch {}
  return false;
}

export function clearCache() {
  localStorage.removeItem(CACHE_KEY);
}

export async function sync() {
  applySync(await api('sync'));
}

export async function saveSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  cache.settings = S.settings;
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  await api('settings/save', { body: { settings: S.settings } });
}

// ---------------------------------------------------------------- active workout persistence

export function loadActive() {
  try { S.active = JSON.parse(localStorage.getItem(ACTIVE_KEY)); } catch { S.active = null; }
  return S.active;
}

export function saveActive() {
  if (S.active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(S.active));
  else localStorage.removeItem(ACTIVE_KEY);
}

// ---------------------------------------------------------------- statistics

/** Epley estimate of one-rep max. Only meaningful for 1–12 reps. */
export function e1rm(w, r) {
  if (!w || !r) return 0;
  if (r === 1) return w;
  return w * (1 + Math.min(r, 12) / 30);
}

export function workSets(item) {
  return (item.sets || []).filter((s) => s.done && !s.warm);
}

/** All sessions for an exercise, oldest first: [{workout, date, sets}] */
export function exerciseHistory(exId, beforeTs = Infinity) {
  const out = [];
  for (const w of S.workouts) {
    if (w.started_at >= beforeTs) continue;
    const sets = [];
    for (const it of w.items || []) if (it.ex === exId) sets.push(...workSets(it));
    if (sets.length) out.push({ workout: w, date: w.started_at, sets });
  }
  return out;
}

export function lastPerformance(exId, beforeTs) {
  const h = exerciseHistory(exId, beforeTs);
  return h.length ? h[h.length - 1] : null;
}

export function bests(exId, beforeTs) {
  const b = { e1rm: 0, weight: 0, reps: 0, seconds: 0, volume: 0 };
  for (const sess of exerciseHistory(exId, beforeTs)) {
    let vol = 0;
    for (const s of sess.sets) {
      b.e1rm = Math.max(b.e1rm, e1rm(s.w, s.r));
      b.weight = Math.max(b.weight, s.w || 0);
      b.reps = Math.max(b.reps, s.r || 0);
      b.seconds = Math.max(b.seconds, s.s || 0);
      vol += (s.w || 0) * (s.r || 0);
    }
    b.volume = Math.max(b.volume, vol);
  }
  return b;
}

/**
 * Progressive overload suggestion: if every work set of the last session hit the target,
 * add one increment; otherwise repeat the weight.
 */
export function suggest(exId, target) {
  const ex = exercise(exId);
  const last = lastPerformance(exId);
  if (!last) return { w: null, r: target, note: null };
  const top = Math.max(...last.sets.map((s) => s.w || 0));
  if (ex.type === 'time') {
    const best = Math.max(...last.sets.map((s) => s.s || 0));
    return { w: top || null, s: best >= target ? best + 5 : target, note: null };
  }
  if (!ex.inc || !top) {
    const bestReps = Math.max(...last.sets.map((s) => s.r || 0));
    return { w: top || null, r: Math.max(target, bestReps >= target ? bestReps + 1 : target), note: null };
  }
  const topSets = last.sets.filter((s) => s.w === top);
  const allHit = topSets.every((s) => (s.r || 0) >= target);
  if (allHit) return { w: Math.round((top + ex.inc) * 100) / 100, r: target, note: `+${String(ex.inc).replace('.', ',')} kg` };
  return { w: top, r: target, note: null };
}

export function workoutVolume(w) {
  let v = 0, sets = 0;
  for (const it of w.items || []) {
    for (const s of workSets(it)) {
      v += (s.w || 0) * (s.r || 0);
      sets++;
    }
  }
  return { volume: v, sets };
}

/** Records broken in a workout compared with everything before it. */
export function workoutPRs(w) {
  const prs = [];
  const seen = new Set();
  for (const it of w.items || []) {
    if (seen.has(it.ex)) continue;
    seen.add(it.ex);
    const sets = (w.items || []).filter((x) => x.ex === it.ex).flatMap(workSets);
    if (!sets.length) continue;
    const prev = bests(it.ex, w.started_at);
    if (!exerciseHistory(it.ex, w.started_at).length) continue; // first time is not a record
    const ex = exercise(it.ex);
    const best1 = Math.max(...sets.map((s) => e1rm(s.w, s.r)));
    const bestW = Math.max(...sets.map((s) => s.w || 0));
    const bestS = Math.max(...sets.map((s) => s.s || 0));
    const bestR = Math.max(...sets.map((s) => s.r || 0));
    if (bestW > prev.weight && bestW > 0) prs.push({ ex: it.ex, kind: 'Zwaarste set', value: `${bestW} kg` });
    else if (best1 > prev.e1rm + 0.01 && ex.inc) prs.push({ ex: it.ex, kind: 'Geschatte 1RM', value: `${Math.round(best1 * 10) / 10} kg` });
    else if (!ex.inc && ex.type !== 'time' && bestR > prev.reps) prs.push({ ex: it.ex, kind: 'Meeste herhalingen', value: `${bestR}×` });
    else if (ex.type === 'time' && bestS > prev.seconds) prs.push({ ex: it.ex, kind: 'Langste tijd', value: `${bestS} s` });
  }
  return prs;
}

export function startOfWeek(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Consecutive weeks (ending this or last week) with at least one workout. */
export function weekStreak() {
  const weeks = new Set(S.workouts.map((w) => startOfWeek(new Date(w.started_at * 1000)).getTime()));
  let cur = startOfWeek();
  if (!weeks.has(cur.getTime())) cur.setDate(cur.getDate() - 7);
  let n = 0;
  while (weeks.has(cur.getTime())) {
    n++;
    cur.setDate(cur.getDate() - 7);
  }
  return n;
}

/** Hard sets per muscle group in the last N days (primary muscle counts 1, secondary 0.5). */
export function setsPerMuscle(days = 7) {
  const since = Date.now() / 1000 - days * 86400;
  const out = {};
  for (const w of S.workouts) {
    if (w.started_at < since) continue;
    for (const it of w.items || []) {
      if (it.group === 'warm' || it.group === 'cool') continue;
      const ex = exercise(it.ex);
      const n = workSets(it).length;
      (ex.muscles || []).forEach((m, i) => {
        if (m === 'conditie') return;
        out[m] = (out[m] || 0) + n * (i === 0 ? 1 : 0.5);
      });
    }
  }
  return out;
}
