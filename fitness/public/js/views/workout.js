// The active workout: log sets, see last time, automatic rest timer, supersets, timed sets.
import { h, icon, iconBtn, sheet, toast, fmtDuration, fmtKg, fmtDate, parseNum, uid, confirmDialog, chips, empty, mount } from '../ui.js';
import { S, exercise, saveActive, suggest, lastPerformance, workoutVolume, workoutPRs } from '../store.js';
import { queue, errorMessage } from '../api.js';
import { exThumb, exerciseInfo, pickExercise, plateSheet } from '../components.js';
import { startTimer, stopTimer, keepAwake, unlockAudio } from '../timer.js';
import { go, refresh } from '../app.js';

const isBlock = (it) => it.group === 'warm' || it.group === 'cool';

function makeSets(exId, n, target) {
  const ex = exercise(exId);
  const sg = suggest(exId, target);
  return Array.from({ length: n }, () => ({
    w: sg.w,
    r: ex.type === 'time' ? null : sg.r ?? target,
    s: ex.type === 'time' ? sg.s ?? target : null,
    warm: false,
    done: false,
  }));
}

export function startWorkout(d) {
  unlockAudio();
  stopTimer();
  S.active = {
    uid: uid(),
    name: d.name || 'Training',
    goal: d.goal || '',
    focus: d.focus || '',
    started_at: Math.floor(Date.now() / 1000),
    lastRest: 90,
    items: d.items.map((it) => ({
      ex: it.ex,
      group: it.group,
      rest: it.rest ?? exercise(it.ex).rest,
      target: it.target ?? exercise(it.ex).reps,
      note: isBlock(it) ? null : suggest(it.ex, it.target).note,
      sets: makeSets(it.ex, isBlock(it) ? 1 : it.sets || 3, it.target ?? exercise(it.ex).reps),
    })),
  };
  saveActive();
  keepAwake(true);
  go('#/workout');
}

export function workoutView(root) {
  const A = S.active;
  if (!A) {
    mount(root, empty('Er loopt geen training.', h('a.btn', { href: '#/' }, 'Naar vandaag')));
    return;
  }
  keepAwake(true);

  const clock = h('span.pill');
  const updateClock = () => (clock.textContent = fmtDuration(Date.now() / 1000 - A.started_at));
  updateClock();
  const iv = setInterval(() => (root.isConnected && clock.isConnected ? updateClock() : clearInterval(iv)), 1000);

  const list = h('div.workout-list');
  const cards = [];

  const render = () => {
    cards.length = 0;
    const warm = A.items.map((it, i) => [it, i]).filter(([it]) => it.group === 'warm');
    const main = A.items.map((it, i) => [it, i]).filter(([it]) => !isBlock(it));
    const cool = A.items.map((it, i) => [it, i]).filter(([it]) => it.group === 'cool');
    mount(list, 
      warm.length ? blockCard('Warming-up', warm) : null,
      ...main.map(([it, i]) => itemCard(it, i)),
      h('button.btn.ghost.block', { type: 'button', onclick: addExercise }, icon('plus'), ' Oefening toevoegen'),
      cool.length ? blockCard('Cooling-down', cool) : null,
    );
  };

  const persist = () => saveActive();

  // ------------------------------------------------------------ set completion & rest logic

  const afterSetDone = (i) => {
    const it = A.items[i];
    if (isBlock(it)) return;
    const letter = (it.group || '').replace(/\d+$/, '');
    const partners = A.items.map((x, k) => [x, k]).filter(([x]) => !isBlock(x) && (x.group || '').replace(/\d+$/, '') === letter && /\d$/.test(x.group || ''));
    const pos = partners.findIndex(([, k]) => k === i);
    if (partners.length > 1 && pos < partners.length - 1) {
      // Superset: go straight to the next exercise of the pair, rest comes after the last one.
      const [next, nk] = partners[pos + 1];
      toast(`Superset: door naar ${exercise(next.ex).name}`);
      cards[nk]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const allDone = A.items.every((x) => x.sets.every((s) => s.done));
    if (allDone) {
      toast('Alles gedaan! Rond je training af. 🎉', 'ok');
      return;
    }
    const rest = partners.length > 1 ? Math.max(...partners.map(([x]) => x.rest || 0)) : it.rest;
    A.lastRest = rest || A.lastRest;
    persist();
    if (S.settings.autoRest && rest) startTimer(rest, { label: 'Rust · daarna ' + nextUpLabel(i) });
    if (it.sets.every((s) => s.done)) {
      const nextIdx = A.items.findIndex((x, k) => k > i && !isBlock(x) && x.sets.some((s) => !s.done));
      if (nextIdx >= 0) setTimeout(() => cards[nextIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    }
  };

  const nextUpLabel = (i) => {
    const it = A.items[i];
    if (it.sets.some((s) => !s.done)) return exercise(it.ex).name;
    const letter = (it.group || '').replace(/\d+$/, '');
    const first = A.items.find((x) => (x.group || '').replace(/\d+$/, '') === letter && x.sets.some((s) => !s.done));
    if (first) return exercise(first.ex).name;
    const next = A.items.find((x, k) => k > i && !isBlock(x) && x.sets.some((s) => !s.done));
    return next ? exercise(next.ex).name : 'afronden';
  };

  const toggleDone = (i, j, row) => {
    const set = A.items[i].sets[j];
    set.done = !set.done;
    persist();
    row.classList.toggle('done', set.done);
    updateCardState(i);
    if (set.done) {
      if (navigator.vibrate && S.settings.vibrate) navigator.vibrate(30);
      afterSetDone(i);
    }
  };

  const runWorkTimer = (i, j, row) => {
    const it = A.items[i];
    const set = it.sets[j];
    const ex = exercise(it.ex);
    startTimer(set.s || it.target, {
      mode: 'work',
      label: ex.name,
      onDone: () => {
        if (!set.done) toggleDone(i, j, row);
      },
    });
  };

  const updateCardState = (i) => {
    const card = cards[i];
    if (card && !isBlock(A.items[i])) card.classList.toggle('complete', A.items[i].sets.every((s) => s.done));
  };

  // ------------------------------------------------------------ cards

  const setRow = (i, j) => {
    const it = A.items[i];
    const ex = exercise(it.ex);
    const set = it.sets[j];
    const timed = ex.type === 'time';
    const workIndex = it.sets.slice(0, j + 1).filter((s) => !s.warm).length;

    const propagate = (field, oldVal, newVal) => {
      // Changing a value also updates the following, not yet completed sets that had the same value.
      for (let k = j + 1; k < it.sets.length; k++) {
        const s = it.sets[k];
        if (!s.done && s[field] === oldVal) {
          s[field] = newVal;
          const inp = row.parentElement?.children[k]?.querySelector(`[data-f="${field}"]`);
          if (inp) inp.value = field === 'w' ? fmtKg(newVal) : newVal ?? '';
        }
      }
    };

    const numInput = (field, label, decimal) => h('input.num', {
      type: 'text',
      inputMode: decimal ? 'decimal' : 'numeric',
      value: field === 'w' ? fmtKg(set.w) : set[field] ?? '',
      placeholder: field === 'w' ? (ex.inc ? 'kg' : '—') : timed ? 's' : 'reps',
      'aria-label': `${label} set ${j + 1}`,
      'data-f': field,
      onfocus: (e) => e.target.select(),
      onchange: (e) => {
        const old = set[field];
        const v = parseNum(e.target.value);
        set[field] = v === null ? null : field === 'w' ? v : Math.round(v);
        propagate(field, old, set[field]);
        persist();
      },
    });

    const row = h('div.set-row' + (set.done ? '.done' : '') + (set.warm ? '.warm' : ''),
      h('button.set-label', {
        type: 'button',
        title: 'Tik om als opwarmset te markeren',
        onclick: () => { set.warm = !set.warm; persist(); render(); },
      }, set.warm ? 'W' : String(workIndex)),
      numInput('w', 'Gewicht', true),
      h('span.x', '×'),
      timed ? numInput('s', 'Seconden', false) : numInput('r', 'Herhalingen', false),
      timed ? iconBtn('play', 'Start timer', () => runWorkTimer(i, j, row), 'play-btn') : null,
      h('button.check-btn', { type: 'button', 'aria-label': `Set ${j + 1} klaar`, onclick: () => toggleDone(i, j, row) }, icon('check')));
    return row;
  };

  const itemCard = (it, i) => {
    const ex = exercise(it.ex);
    const last = lastPerformance(it.ex, A.started_at);
    const lastText = last
      ? last.sets.map((s) => (ex.type === 'time' ? `${s.s ?? '?'} s` : `${s.w ? fmtKg(s.w) + '×' : ''}${s.r ?? '?'}`)).join(' · ')
      : null;
    const sets = h('div.sets', it.sets.map((_, j) => setRow(i, j)));
    const card = h('article.ex-card' + (it.sets.every((s) => s.done) ? '.complete' : ''),
      h('div.ex-card-head',
        h('span.group-badge', it.group),
        h('button.b-thumb', { type: 'button', 'aria-label': 'Uitleg', onclick: () => exerciseInfo(ex.id) }, exThumb(ex)),
        h('div.grow',
          h('button.ex-name', { type: 'button', onclick: () => exerciseInfo(ex.id) }, ex.name),
          h('div.small.muted', `${it.sets.length} × ${ex.type === 'time' ? it.target + ' s' : it.target}${it.rest ? ' · rust ' + it.rest + ' s' : ''}`)),
        iconBtn('more', 'Opties', () => itemMenu(i))),
      lastText ? h('p.last-time', icon('timer'), ` Vorige keer (${fmtDate(last.date, false)}): ${lastText}`, it.note ? h('span.badge.up', it.note) : null) : h('p.last-time.muted', 'Eerste keer: kies een gewicht waarmee je de reps net haalt.'),
      sets);
    cards[i] = card;
    return card;
  };

  const blockCard = (title, entries) => h('article.ex-card.block-card',
    h('h3', title),
    entries.map(([it, i]) => {
      const ex = exercise(it.ex);
      const set = it.sets[0];
      const row = h('div.block-row' + (set.done ? '.done' : ''),
        h('button.b-thumb', { type: 'button', 'aria-label': 'Uitleg', onclick: () => exerciseInfo(ex.id) }, exThumb(ex)),
        h('button.grow.b-text', { type: 'button', onclick: () => exerciseInfo(ex.id) }, h('strong', ex.name), h('span.muted', `${set.s || it.target} s`)),
        iconBtn('play', 'Start timer', () => runWorkTimer(i, 0, row), 'play-btn'),
        h('button.check-btn', { type: 'button', 'aria-label': ex.name + ' klaar', onclick: () => toggleDone(i, 0, row) }, icon('check')));
      cards[i] = row;
      return row;
    }));

  // ------------------------------------------------------------ menus

  const itemMenu = (i) => {
    const it = A.items[i];
    const ex = exercise(it.ex);
    const sh = sheet(ex.name, [
      h('div.menu',
        h('button', { type: 'button', onclick: () => { sh.close(); exerciseInfo(ex.id); } }, icon('info'), ' Uitleg & tips'),
        h('button', {
          type: 'button',
          onclick: () => {
            const prev = it.sets[it.sets.length - 1];
            it.sets.push({ ...(prev || makeSets(it.ex, 1, it.target)[0]), done: false, warm: false });
            persist(); sh.close(); render();
          },
        }, icon('plus'), ' Set toevoegen'),
        h('button', {
          type: 'button',
          onclick: () => {
            const first = it.sets.find((s) => !s.warm) || it.sets[0];
            it.sets.unshift({ ...first, w: first?.w ? Math.round(first.w * 0.5 / 2.5) * 2.5 : null, r: ex.type === 'time' ? null : 10, warm: true, done: false });
            persist(); sh.close(); render();
          },
        }, icon('plus'), ' Opwarmset toevoegen'),
        it.sets.length > 1 ? h('button', {
          type: 'button',
          onclick: () => {
            const idx = it.sets.map((s) => s.done).lastIndexOf(false);
            it.sets.splice(idx >= 0 ? idx : it.sets.length - 1, 1);
            persist(); sh.close(); render();
          },
        }, icon('minus'), ' Set verwijderen') : null,
        h('button', {
          type: 'button',
          onclick: async () => {
            sh.close();
            const id = await pickExercise({ pattern: ex.pattern, title: 'Wissel ' + ex.name, exclude: [it.ex] });
            if (!id) return;
            const nex = exercise(id);
            it.ex = id;
            if (nex.type !== ex.type) it.target = nex.reps;
            it.note = suggest(id, it.target).note;
            const doneSets = it.sets.filter((s) => s.done);
            it.sets = [...doneSets, ...makeSets(id, Math.max(1, it.sets.length - doneSets.length), it.target)];
            persist(); render();
          },
        }, icon('swap'), ' Wissel oefening'),
        (ex.equip || []).includes('barbell') ? h('button', {
          type: 'button',
          onclick: () => { sh.close(); plateSheet((it.sets.find((s) => !s.done) || it.sets[0])?.w); },
        }, icon('dumbbell'), ' Schijvencalculator') : null,
        h('label.field-row', h('span', 'Rusttijd'),
          chips([[45, '45s'], [60, '60s'], [90, '90s'], [120, '2m'], [180, '3m']], it.rest, (v) => { it.rest = v; persist(); render(); })),
        h('button.danger-text', {
          type: 'button',
          onclick: async () => {
            sh.close();
            if (await confirmDialog(`${ex.name} uit deze training halen?`, 'Verwijderen', true)) {
              A.items.splice(i, 1);
              persist(); render();
            }
          },
        }, icon('trash'), ' Oefening verwijderen')),
    ]);
  };

  const addExercise = async () => {
    const id = await pickExercise({ title: 'Oefening toevoegen' });
    if (!id) return;
    const ex = exercise(id);
    const coolIdx = A.items.findIndex((x) => x.group === 'cool');
    const letters = A.items.filter((x) => !isBlock(x)).map((x) => (x.group || 'A').charCodeAt(0));
    const letter = String.fromCharCode(Math.min(90, Math.max(64, ...letters) + 1));
    const item = { ex: id, group: letter, rest: ex.rest, target: ex.reps, note: suggest(id, ex.reps).note, sets: makeSets(id, 3, ex.reps) };
    if (coolIdx >= 0) A.items.splice(coolIdx, 0, item);
    else A.items.push(item);
    persist();
    render();
    setTimeout(() => cards[A.items.indexOf(item)]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  mount(root, 
    h('header.page-head.workout-head',
      h('div.grow', h('h1', A.name), h('p.muted', 'Bezig ', clock)),
      h('button.btn.ghost.small', { type: 'button', onclick: () => startTimer(A.lastRest || 90, { label: 'Rust' }) }, icon('timer'), ' Rust'),
      h('button.btn.small', { type: 'button', onclick: () => finishSheet() }, 'Afronden')),
    list,
  );
  render();
}

// ---------------------------------------------------------------- finish

function finishSheet() {
  const A = S.active;
  const undone = A.items.reduce((n, it) => n + it.sets.filter((s) => !s.done).length, 0);
  const { volume, sets } = workoutVolume(A);
  let rating = null;
  const notes = h('textarea', { rows: 3, placeholder: 'Hoe ging het? Pijntjes, energie, iets om te onthouden…' });
  const sh = sheet('Training afronden', [
    h('div.stat-row',
      h('div.stat', h('div.stat-value', fmtDuration(Date.now() / 1000 - A.started_at)), h('div.stat-label', 'Duur')),
      h('div.stat', h('div.stat-value', sets), h('div.stat-label', 'Sets')),
      h('div.stat', h('div.stat-value', Math.round(volume).toLocaleString('nl-NL')), h('div.stat-label', 'kg volume'))),
    undone ? h('p.warn', `${undone} set(s) niet afgevinkt. Die worden niet meegeteld.`) : null,
    h('div.field', h('span.label', 'Hoe voelde het?'), chips([[1, '😩'], [2, '😕'], [3, '🙂'], [4, '😀'], [5, '🔥']], rating, (v) => (rating = v))),
    h('label.field', h('span.label', 'Notities'), notes),
    h('button.btn.block.big', { type: 'button', onclick: () => save() }, 'Opslaan'),
    h('button.btn.ghost.block.danger-text', {
      type: 'button',
      onclick: async () => {
        if (!(await confirmDialog('Training weggooien zonder op te slaan?', 'Weggooien', true))) return;
        endActive();
        sh.close();
        go('#/', true);
      },
    }, 'Weggooien'),
  ]);

  const save = async () => {
    const workout = {
      uid: A.uid,
      name: A.name,
      goal: A.goal,
      focus: A.focus,
      started_at: A.started_at,
      finished_at: Math.floor(Date.now() / 1000),
      rating,
      notes: notes.value,
      items: A.items
        .filter((it) => it.sets.some((s) => s.done))
        .map(({ ex, group, rest, target, sets: ss }) => ({ ex, group, rest, target, sets: ss })),
    };
    if (!workout.items.length) {
      toast('Nog geen enkele set afgevinkt.');
      return;
    }
    const prs = workoutPRs(workout);
    S.workouts.push({ ...workout, pending: true });
    endActive();
    sh.close();
    showSummary(workout, prs);
    try {
      await queue('workouts/save', { workout });
      await refresh();
    } catch (e) {
      if (e.code === 'network') toast('Offline opgeslagen: wordt gesynchroniseerd zodra je online bent.');
      else toast(errorMessage(e), 'error');
    }
  };
}

function endActive() {
  S.active = null;
  saveActive();
  stopTimer();
  keepAwake(false);
}

function showSummary(w, prs) {
  const { volume, sets } = workoutVolume(w);
  sheet('Goed gedaan! 💪', [
    h('div.stat-row',
      h('div.stat', h('div.stat-value', fmtDuration(w.finished_at - w.started_at)), h('div.stat-label', 'Duur')),
      h('div.stat', h('div.stat-value', sets), h('div.stat-label', 'Sets')),
      h('div.stat', h('div.stat-value', Math.round(volume).toLocaleString('nl-NL')), h('div.stat-label', 'kg volume'))),
    prs.length ? h('div.prs',
      h('h3', icon('trophy'), ` ${prs.length} persoonlijk${prs.length > 1 ? 'e records' : ' record'}!`),
      prs.map((p) => h('div.pr-row', h('strong', exercise(p.ex).name), h('span', `${p.kind}: ${p.value}`)))) : h('p.muted', 'Elke training telt. Volgende keer weer een stapje verder.'),
    h('a.btn.block', { href: '#/results' }, 'Naar resultaten'),
  ], { onClose: () => go('#/', true) });
}
