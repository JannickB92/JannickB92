// Rule-based workout generator: goal + available time + equipment -> a complete session.
// No schedule needed: it looks at recent history to rotate focus and keep main lifts consistent.
import { S, allExercises, exercise } from './store.js';

const GOAL_PARAMS = {
  kracht: {
    main: { sets: 4, reps: 5, rest: 150 },
    acc: { sets: 3, reps: 8, rest: 75 },
    supersetMains: false,
  },
  spiermassa: {
    main: { sets: 3, reps: 8, rest: 105 },
    acc: { sets: 3, reps: 12, rest: 60 },
    supersetMains: true,
  },
  atletisch: {
    power: { sets: 3, reps: 5, rest: 60 },
    main: { sets: 3, reps: 8, rest: 75 },
    acc: { sets: 2, reps: 12, rest: 45 },
    supersetMains: true,
    finisher: true,
  },
};

// Slot lists in priority order. "main" slots prefer consistent, progressable compound lifts.
const FOCUS_SLOTS = {
  'full-A': [['squat', 'main'], ['push_h', 'main'], ['pull_v', 'main'], ['hinge', 'acc'], ['shoulders', 'acc'], ['core', 'acc'], ['biceps', 'acc'], ['triceps', 'acc']],
  'full-B': [['hinge', 'main'], ['push_v', 'main'], ['pull_h', 'main'], ['lunge', 'acc'], ['chest_iso', 'acc'], ['core', 'acc'], ['triceps', 'acc'], ['biceps', 'acc']],
  upper: [['push_h', 'main'], ['pull_h', 'main'], ['push_v', 'main'], ['pull_v', 'main'], ['shoulders', 'acc'], ['biceps', 'acc'], ['triceps', 'acc'], ['core', 'acc']],
  lower: [['squat', 'main'], ['hinge', 'main'], ['lunge', 'acc'], ['legs_iso', 'acc'], ['glutes', 'acc'], ['calves', 'acc'], ['core', 'acc']],
};

export const FOCUS_LABELS = { 'full-A': 'Volledig lichaam A', 'full-B': 'Volledig lichaam B', upper: 'Bovenlichaam', lower: 'Onderlichaam' };

const WARMUP_BY_FOCUS = {
  upper: ['arm_circles', 'dynamic_chest', 'cat_cow', 'worlds_greatest'],
  lower: ['hip_circles', 'worlds_greatest', 'ankle_circles', 'groiners'],
  full: ['worlds_greatest', 'arm_circles', 'hip_circles', 'groiners', 'cat_cow'],
};

const SET_WORK_SECONDS = 40;
const SWITCH_SECONDS = 60;

function rng(seed) {
  let x = seed || Date.now();
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

function available(ex, equipment) {
  const have = new Set([...equipment, 'bodyweight']);
  if (!(ex.equip || []).some((e) => have.has(e))) return false;
  return (ex.needs || []).every((n) => have.has(n));
}

/** How the user trained recently: usage counts and last-used timestamps per exercise. */
function usage(days = 42) {
  const since = Date.now() / 1000 - days * 86400;
  const count = {}, last = {};
  for (const w of S.workouts) {
    for (const it of w.items || []) {
      if (w.started_at >= since) count[it.ex] = (count[it.ex] || 0) + 1;
      last[it.ex] = Math.max(last[it.ex] || 0, w.started_at);
    }
  }
  const lastWorkout = S.workouts[S.workouts.length - 1];
  const inLast = new Set((lastWorkout?.items || []).map((i) => i.ex));
  return { count, last, inLast };
}

export function resolveFocus(focus) {
  if (focus === 'upper' || focus === 'lower') return focus;
  // auto / full: alternate full-body A and B; after an upper day do lower and vice versa.
  const lastFocus = [...S.workouts].reverse().find((w) => w.focus)?.focus;
  if (focus === 'auto') {
    if (lastFocus === 'upper') return 'lower';
    if (lastFocus === 'lower') return 'upper';
  }
  return lastFocus === 'full-A' ? 'full-B' : 'full-A';
}

function pick(pattern, role, ctx, extraFilter) {
  const cands = allExercises().filter((ex) =>
    ex.pattern === pattern && available(ex, ctx.equipment) && !ctx.used.has(ex.id) && (!extraFilter || extraFilter(ex)));
  if (!cands.length) return null;
  const scored = cands.map((ex) => {
    let score = ctx.rand() * 4;
    const n = ctx.usage.count[ex.id] || 0;
    if (role === 'main') {
      if (ex.main) score += 8;
      score += Math.min(n, 6) * 4; // keep doing the same main lift so progress is measurable
      if (ctx.goal === 'kracht' && (ex.equip || []).includes('barbell')) score += 6;
      if (ex.compound) score += 3;
    } else {
      if (ctx.usage.inLast.has(ex.id)) score -= 6; // variety in accessories
      score += Math.min(n, 3);
    }
    if (ex.custom) score += 2;
    return { ex, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].ex;
}

function timedItem(ex, group) {
  return { ex: ex.id, group, sets: 1, target: ex.reps, rest: 0 };
}

/**
 * @param {{goal, minutes, focus, equipment, extraMuscle, warmup, cooldown, seed}} opts
 * @returns {{name, goal, focus, items, estimate}}
 */
export function generate(opts) {
  const goal = GOAL_PARAMS[opts.goal] ? opts.goal : 'spiermassa';
  const P = GOAL_PARAMS[goal];
  const focus = resolveFocus(opts.focus || 'auto');
  const ctx = { goal, equipment: opts.equipment || [], used: new Set(), usage: usage(), rand: rng(opts.seed) };
  let budget = (opts.minutes || 45) * 60;

  // 1. Warm-up (always short; scales with available time)
  const warm = [];
  if (opts.warmup !== false) {
    const key = focus.startsWith('full') ? 'full' : focus;
    const ids = [...WARMUP_BY_FOCUS[key]].sort(() => ctx.rand() - 0.5).slice(0, opts.minutes <= 20 ? 3 : 4);
    for (const id of ids) if (S.byId[id]) warm.push(timedItem(S.byId[id], 'warm'));
  }
  budget -= warm.reduce((t, i) => t + i.target + 5, 0);

  // Reserve time for the cool-down so it doesn't get squeezed out.
  const coolReserve = opts.cooldown !== false && opts.minutes >= 30 ? 150 : 0;
  budget -= coolReserve;

  // 2. Build candidate blocks
  const blocks = [];
  const add = (pattern, role, params, filter) => {
    const ex = pick(pattern, role, ctx, filter);
    if (!ex) return null;
    ctx.used.add(ex.id);
    const item = {
      ex: ex.id,
      role,
      sets: params.sets,
      target: ex.type === 'time' || role === 'power' ? ex.reps : (role === 'main' ? params.reps : Math.max(params.reps, Math.min(ex.reps, 15))),
      rest: Math.max(30, Math.round((ex.type === 'time' ? Math.min(ex.rest, params.rest) : params.rest) / 15) * 15),
    };
    blocks.push(item);
    return item;
  };

  if (goal === 'atletisch') add('power', 'power', P.power);
  const slots = [...FOCUS_SLOTS[focus]];
  if (opts.extraMuscle) {
    // Extra attention for one muscle group: insert an accessory for it right after the main lifts.
    const idx = slots.findIndex(([, r]) => r === 'acc');
    slots.splice(idx, 0, ['__extra', 'acc']);
  }
  for (const [pattern, role] of slots) {
    if (pattern === '__extra') {
      const m = opts.extraMuscle;
      const cands = allExercises().filter((e) => (e.muscles || [])[0] === m && !['warmup', 'stretch'].includes(e.pattern));
      const patternsForMuscle = [...new Set(cands.map((e) => e.pattern))];
      for (const p of patternsForMuscle) {
        if (add(p, 'acc', P.acc, (e) => (e.muscles || [])[0] === m)) break;
      }
      continue;
    }
    add(pattern, role, role === 'main' ? P.main : P.acc);
  }
  if (P.finisher) {
    add('carry', 'acc', { sets: 2, reps: 40, rest: 60 }) || add('conditioning', 'acc', { sets: 2, reps: 10, rest: 60 });
  }

  // 3. Group into supersets (pair consecutive items) where the goal allows it
  const groups = [];
  let i = 0;
  while (i < blocks.length) {
    const a = blocks[i], b = blocks[i + 1];
    // Short on time: even strength sessions superset the main lifts (except the first one).
    const ssMains = P.supersetMains || (opts.minutes || 45) <= 30;
    const mainSolo = a.role === 'power' || (a.role === 'main' && (!ssMains || groups.length === 0));
    const canPair = b && !mainSolo && b.role !== 'power' && !(b.role === 'main' && !ssMains);
    if (canPair) {
      groups.push([a, b]);
      i += 2;
    } else {
      groups.push([a]);
      i += 1;
    }
  }

  // 4. Fit groups into the time budget, in priority order
  const groupTime = (g) => {
    const sets = Math.max(...g.map((x) => x.sets));
    const work = g.reduce((t, x) => t + (exercise(x.ex).type === 'time' ? x.target : SET_WORK_SECONDS), 0);
    const rest = Math.max(...g.map((x) => x.rest));
    return sets * (work + rest) + SWITCH_SECONDS * g.length;
  };
  const chosen = [];
  const tryFit = (g) => {
    // Shorten the group (fewer sets) before dropping it: main lifts matter more than extra sets.
    while (groupTime(g) > budget && g.some((x) => x.sets > 2)) {
      for (const x of g) if (x.sets > 2) x.sets--;
    }
    if (groupTime(g) <= budget) {
      chosen.push(g);
      budget -= groupTime(g);
      return true;
    }
    return false;
  };
  // Main lifts first (in order), then accessories with whatever time is left.
  const isMain = (g) => g.some((x) => x.role === 'main' || x.role === 'power');
  for (const g of groups.filter(isMain)) if (!tryFit(g) && g.length === 2) tryFit([g[0]]);
  for (const g of groups.filter((x) => !isMain(x))) if (!tryFit(g) && g.length === 2) tryFit([g[0]]);
  chosen.sort((a, b) => groups.indexOf(a) - groups.indexOf(b));
  // Leftover time: add an extra set to the main lifts
  for (const g of chosen) {
    for (const it of g) {
      if (it.role === 'main' && it.sets < 5) {
        const extra = (exercise(it.ex).type === 'time' ? it.target : SET_WORK_SECONDS) + it.rest;
        if (extra <= budget) {
          it.sets++;
          budget -= extra;
        }
      }
    }
  }

  // 5. Labels: A, B1/B2, C...
  const items = [...warm];
  chosen.forEach((g, gi) => {
    const letter = String.fromCharCode(65 + gi);
    g.forEach((it, k) => items.push({ ex: it.ex, group: g.length > 1 ? letter + (k + 1) : letter, sets: it.sets, target: it.target, rest: it.rest }));
  });

  // 6. Cool-down: stretches for the muscles that were trained most
  if (coolReserve) {
    const load = {};
    for (const it of items) for (const m of exercise(it.ex).muscles || []) load[m] = (load[m] || 0) + 1;
    const stretches = allExercises().filter((e) => e.pattern === 'stretch')
      .map((e) => ({ e, score: (e.muscles || []).reduce((t, m) => t + (load[m] || 0), 0) + ctx.rand() }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    for (const { e } of stretches) items.push(timedItem(e, 'cool'));
  }

  return {
    name: FOCUS_LABELS[focus],
    goal,
    focus,
    items,
    estimate: estimate(items),
  };
}

/** Rough duration estimate (seconds) for a list of items. */
export function estimate(items) {
  let t = 0;
  const seenGroups = new Map();
  for (const it of items) {
    const ex = exercise(it.ex);
    const work = ex.type === 'time' ? (it.target || ex.reps) : SET_WORK_SECONDS;
    if (it.group === 'warm' || it.group === 'cool') {
      t += work + 5;
      continue;
    }
    const letter = (it.group || '').replace(/\d+$/, '');
    const isPartner = /\d$/.test(it.group || '') && seenGroups.has(letter);
    // In a superset the rest is shared, so only the first exercise "pays" for rest.
    t += it.sets * (work + (isPartner ? 0 : it.rest)) + SWITCH_SECONDS;
    seenGroups.set(letter, true);
  }
  return t;
}

/** Recompute group labels after editing (items carry a `link` flag meaning "superset with next"). */
export function relabel(items) {
  let gi = 0;
  const out = [];
  let i = 0;
  const body = items.filter((x) => x.group !== 'warm' && x.group !== 'cool');
  const warm = items.filter((x) => x.group === 'warm');
  const cool = items.filter((x) => x.group === 'cool');
  while (i < body.length) {
    const letter = String.fromCharCode(65 + (gi % 26));
    const run = [body[i]];
    while (body[i + run.length - 1].link && i + run.length < body.length) run.push(body[i + run.length]);
    run.forEach((it, k) => {
      it.group = run.length > 1 ? letter + (k + 1) : letter;
      it.link = k < run.length - 1;
      out.push(it);
    });
    i += run.length;
    gi++;
  }
  return [...warm, ...out, ...cool];
}

/** Derive `link` flags from group labels (B1 followed by B2 => link). */
export function withLinks(items) {
  return items.map((it, i) => {
    const next = items[i + 1];
    const m = /^([A-Z])(\d+)$/.exec(it.group || '');
    const n = next && /^([A-Z])(\d+)$/.exec(next.group || '');
    return { ...it, link: !!(m && n && m[1] === n[1]) };
  });
}
