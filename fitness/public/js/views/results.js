// Results: overview, records, history, workout detail and per-exercise progress.
import { h, icon, iconBtn, fmtDate, fmtDuration, fmtKg, toast, confirmDialog, empty, chips, mount } from '../ui.js';
import { S, exercise, MUSCLES, workoutVolume, workoutPRs, weekStreak, startOfWeek, setsPerMuscle, exerciseHistory, bests, e1rm, workSets } from '../store.js';
import { lineChart, barList, heatmap } from '../chart.js';
import { statTile, exAnimation, exMeta } from '../components.js';
import { api, errorMessage } from '../api.js';
import { refresh, go } from '../app.js';
import { FOCUS_LABELS } from '../generator.js';
import { statsDashboard } from './stats.js';

export function resultsView(root) {
  const ws = S.workouts;
  if (!ws.length) {
    const wrap = h('div');
    mount(root, h('header.page-head', h('h1', 'Statistieken')), wrap);
    statsDashboard(wrap);
    return;
  }
  const weekStart = startOfWeek().getTime() / 1000;
  const thisWeek = ws.filter((w) => w.started_at >= weekStart);
  const vol = thisWeek.reduce((t, w) => t + workoutVolume(w).volume, 0);
  const minutes = thisWeek.reduce((t, w) => t + (w.finished_at - w.started_at) / 60, 0);

  const counts = {};
  for (const w of ws) {
    const d = new Date(w.started_at * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  const muscleSets = setsPerMuscle(7);
  const muscleRows = Object.keys(MUSCLES).filter((m) => m !== 'conditie').map((m) => ({ label: MUSCLES[m], value: Math.round((muscleSets[m] || 0) * 10) / 10 }));

  // Records: exercises with history, sorted by most recently trained
  const exIds = [...new Set(ws.flatMap((w) => (w.items || []).filter((i) => i.group !== 'warm' && i.group !== 'cool' && workSets(i).length).map((i) => i.ex)))];
  const lastTrained = (id) => Math.max(...exerciseHistory(id).map((x) => x.date));
  exIds.sort((a, b) => lastTrained(b) - lastTrained(a));

  let tab = 'overzicht';
  const body = h('div');
  const renderTab = () => {
    if (tab === 'overzicht') {
      statsDashboard(body);
    } else if (tab === 'records') {
      mount(body, h('div.cards', exIds.map((id) => {
        const ex = exercise(id);
        const b = bests(id);
        const value = ex.type === 'time' ? `${b.seconds} s` : ex.inc && b.weight ? `${fmtKg(b.weight)} kg` : `${b.reps} reps`;
        const sub = ex.inc && b.e1rm ? `1RM ± ${fmtKg(Math.round(b.e1rm))} kg` : '';
        return h('a.list-row', { href: '#/exercise/' + id },
          h('div', h('strong', ex.name), h('span.muted', sub)),
          h('span.pill', icon('trophy'), ' ', value));
      })));
    } else {
      mount(body, h('div.cards', [...ws].reverse().map((w) => {
        const { volume, sets } = workoutVolume(w);
        return h('a.list-row', { href: '#/workouts/' + w.uid },
          h('div', h('strong', w.name), h('span.muted', `${fmtDate(w.started_at)} · ${fmtDuration(w.finished_at - w.started_at)} · ${sets} sets${volume ? ' · ' + Math.round(volume).toLocaleString('nl-NL') + ' kg' : ''}`)),
          w.pending ? h('span.pill.warn', 'offline') : w.rating ? h('span', ['😩', '😕', '🙂', '😀', '🔥'][w.rating - 1]) : null);
      })));
    }
  };

  mount(root, 
    h('header.page-head', h('h1', 'Statistieken')),
    chips([['overzicht', 'Overzicht'], ['records', 'Records'], ['geschiedenis', 'Geschiedenis']], tab, (v) => { tab = v; renderTab(); }),
    body);
  renderTab();
}

export function workoutDetailView(root, { id }) {
  const w = S.workouts.find((x) => x.uid === id);
  if (!w) return mount(root, empty('Training niet gevonden.', h('a.btn', { href: '#/results' }, 'Terug')));
  const { volume, sets } = workoutVolume(w);
  const prs = workoutPRs(w);
  mount(root, 
    h('header.page-head', iconBtn('back', 'Terug', () => history.back()),
      h('div.grow', h('h1', w.name), h('p.muted', `${fmtDate(w.started_at)} · ${new Date(w.started_at * 1000).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`))),
    h('div.stat-row',
      statTile('Duur', fmtDuration(w.finished_at - w.started_at)),
      statTile('Sets', sets),
      statTile('Volume', Math.round(volume).toLocaleString('nl-NL'), 'kg')),
    prs.length ? h('section.card.prs', h('h2', icon('trophy'), ' Records'), prs.map((p) => h('div.pr-row', h('strong', exercise(p.ex).name), h('span', `${p.kind}: ${p.value}`)))) : null,
    w.notes ? h('section.card', h('h2', 'Notities'), h('p.pre', w.notes)) : null,
    h('section.card', (w.items || []).map((it) => {
      const ex = exercise(it.ex);
      const done = it.sets.filter((s) => s.done);
      return h('a.detail-ex', { href: '#/exercise/' + it.ex },
        h('div.row.between', h('strong', ex.name), it.group && it.group !== 'warm' && it.group !== 'cool' ? h('span.group-badge', it.group) : null),
        h('div.small', done.map((s) => h('span.set-chip' + (s.warm ? '.warm' : ''), ex.type === 'time' ? `${s.s ?? '?'} s${s.w ? ' @' + fmtKg(s.w) : ''}` : `${s.w ? fmtKg(s.w) + ' kg × ' : ''}${s.r ?? '?'}`))));
    })),
    w.focus && FOCUS_LABELS[w.focus] ? h('p.small.muted', 'Focus: ' + FOCUS_LABELS[w.focus]) : null,
    h('div.row.gap',
      h('button.btn.ghost.grow', {
        type: 'button',
        onclick: () => {
          S.draft = { name: w.name, goal: w.goal, focus: w.focus, items: (w.items || []).map((it) => ({ ex: it.ex, group: it.group, sets: Math.max(1, it.sets.filter((s) => !s.warm).length), target: it.target || exercise(it.ex).reps, rest: it.rest })) };
          go('#/builder');
        },
      }, icon('swap'), ' Herhaal deze training'),
      w.id ? iconBtn('trash', 'Verwijderen', async () => {
        if (!(await confirmDialog('Deze training definitief verwijderen?', 'Verwijderen', true))) return;
        try {
          await api('workouts/delete', { body: { id: w.id } });
          await refresh();
          go('#/results', true);
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
      }, 'danger-text') : null),
  );
}

export function exerciseView(root, { id }) {
  const ex = exercise(id);
  const hist = exerciseHistory(id);
  const b = bests(id);
  const timed = ex.type === 'time';
  const weighted = !!ex.inc && hist.some((x) => x.sets.some((s) => s.w));
  let metric = timed ? 'seconds' : weighted ? 'e1rm' : 'reps';

  const chartWrap = h('div');
  const renderChart = () => {
    const pts = hist.map((x) => {
      const sets = x.sets;
      let y = 0;
      if (metric === 'e1rm') y = Math.max(...sets.map((s) => e1rm(s.w, s.r)));
      if (metric === 'weight') y = Math.max(...sets.map((s) => s.w || 0));
      if (metric === 'volume') y = sets.reduce((t, s) => t + (s.w || 0) * (s.r || 0), 0);
      if (metric === 'reps') y = Math.max(...sets.map((s) => s.r || 0));
      if (metric === 'seconds') y = Math.max(...sets.map((s) => s.s || 0));
      return { x: x.date, y: Math.round(y * 10) / 10 };
    }).filter((p) => p.y > 0);
    const unit = metric === 'reps' ? '' : metric === 'seconds' ? ' s' : ' kg';
    mount(chartWrap, lineChart(pts, { unit, yLabel: 'Voortgang ' + ex.name }));
  };

  const metricOptions = timed ? [['seconds', 'Tijd']] : weighted ? [['e1rm', 'Geschatte 1RM'], ['weight', 'Zwaarste set'], ['volume', 'Volume']] : [['reps', 'Herhalingen']];

  mount(root, 
    h('header.page-head', iconBtn('back', 'Terug', () => history.back()), h('div.grow', h('h1', ex.name))),
    h('div.ex-detail',
      exAnimation(ex),
      h('div',
        exMeta(ex),
        ex.tips?.length ? h('ol.tips', ex.tips.map((t) => h('li', t))) : null,
        ex.link ? h('p', h('a', { href: ex.link, target: '_blank', rel: 'noopener noreferrer' }, 'Bekijk uitleg (video/link)')) : null)),
    hist.length ? [
      h('div.stat-row',
        weighted ? statTile('Zwaarste', fmtKg(b.weight) + ' kg') : null,
        weighted ? statTile('Geschatte 1RM', fmtKg(Math.round(b.e1rm * 10) / 10) + ' kg') : null,
        !weighted && !timed ? statTile('Meeste reps', b.reps) : null,
        timed ? statTile('Langste', b.seconds + ' s') : null,
        statTile('Keer gedaan', hist.length)),
      h('section.card',
        h('h2', 'Voortgang'),
        metricOptions.length > 1 ? chips(metricOptions, metric, (v) => { metric = v; renderChart(); }) : null,
        chartWrap),
      h('section.card',
        h('h2', 'Geschiedenis'),
        [...hist].reverse().slice(0, 30).map((x) => h('a.detail-ex', { href: '#/workouts/' + x.workout.uid },
          h('div.row.between', h('span', fmtDate(x.date)), h('span.muted.small', x.workout.name)),
          h('div.small', x.sets.map((s) => h('span.set-chip', timed ? `${s.s} s` : `${s.w ? fmtKg(s.w) + ' × ' : ''}${s.r}`)))))),
    ] : h('p.muted', 'Nog niet gedaan. Zodra je deze oefening logt, verschijnt hier je voortgang.'),
  );
  if (hist.length) renderChart();
}
