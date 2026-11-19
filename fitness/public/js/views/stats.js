// Statistics dashboard: body (weight trend, waist, BMI), training volume and frequency, strength development.
import { h, icon, chips, fmtKg, fmtMinutes, mount } from '../ui.js';
import { S, exercise, MUSCLES, workoutVolume, weekStreak, startOfWeek, setsPerMuscle, workSets, e1rm } from '../store.js';
import { lineChart, columnChart, barList, heatmap, movingAverage } from '../chart.js';
import { statTile } from '../components.js';
import { analysisCard } from './analysis.js';

const PERIODS = [[28, '4 weken'], [91, '3 maanden'], [365, 'Jaar'], [0, 'Alles']];

function delta(value, { unit = '', invert = false, digits = 1 } = {}) {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 10 ** -digits / 2) return h('span.delta.neutral', '±0' + unit);
  const good = invert ? value < 0 : value > 0;
  const txt = (value > 0 ? '+' : '−') + fmtKg(Math.round(Math.abs(value) * 10 ** digits) / 10 ** digits) + unit;
  return h('span.delta' + (good ? '.up' : '.down'), txt);
}

export function statsDashboard(root) {
  let days = 91;
  const body = h('div');
  const render = () => mount(body, ...sections(days));
  mount(root,
    h('div.scroll-x', chips(PERIODS, days, (v) => { days = v; render(); })),
    body);
  render();
}

function sections(days) {
  const now = Date.now() / 1000;
  const since = days ? now - days * 86400 : 0;
  const ws = S.workouts.filter((w) => w.started_at >= since);
  const weeks = days ? days / 7 : Math.max(1, (now - (S.workouts[0]?.started_at || now)) / (7 * 86400));
  const totalMin = ws.reduce((t, w) => t + (w.finished_at - w.started_at) / 60, 0);
  const totalVol = ws.reduce((t, w) => t + workoutVolume(w).volume, 0);

  // ---- body
  const toPt = (b, key) => ({ x: new Date(b.date + 'T12:00:00').getTime() / 1000, y: b[key] });
  const weightAll = S.body.filter((b) => b.weight).map((b) => toPt(b, 'weight'));
  const weightPts = weightAll.filter((p) => p.x >= since);
  const waistPts = S.body.filter((b) => b.waist).map((b) => toPt(b, 'waist')).filter((p) => p.x >= since);
  const trend = movingAverage(weightAll, 7).filter((p) => p.x >= since);
  const curW = trend.length ? trend[trend.length - 1].y : null;
  const startW = trend.length ? trend[0].y : null;
  const curWaist = waistPts.length ? waistPts[waistPts.length - 1].y : null;
  const height = S.settings.height;
  const bmi = curW && height ? curW / (height / 100) ** 2 : null;
  // Rate per week from a least-squares fit over the period (robust against daily noise).
  let perWeek = null;
  if (weightPts.length >= 3) {
    const n = weightPts.length, mx = weightPts.reduce((t, p) => t + p.x, 0) / n, my = weightPts.reduce((t, p) => t + p.y, 0) / n;
    const num = weightPts.reduce((t, p) => t + (p.x - mx) * (p.y - my), 0);
    const den = weightPts.reduce((t, p) => t + (p.x - mx) ** 2, 0);
    if (den) perWeek = (num / den) * 7 * 86400;
  }

  // ---- training per week (last N weeks, max 26 columns)
  const nWeeks = Math.min(26, Math.max(4, Math.round(days ? days / 7 : weeks)));
  const wk0 = startOfWeek().getTime() / 1000;
  const weekRows = [];
  for (let i = nWeeks - 1; i >= 0; i--) {
    const a = wk0 - i * 7 * 86400, b = a + 7 * 86400;
    const inWeek = S.workouts.filter((w) => w.started_at >= a && w.started_at < b);
    const d = new Date(a * 1000);
    weekRows.push({
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      title: `Week van ${d.getDate()}/${d.getMonth() + 1}`,
      count: inWeek.length,
      volume: Math.round(inWeek.reduce((t, w) => t + workoutVolume(w).volume, 0) / 100) / 10,
    });
  }
  const goalPerWeek = S.analyses[S.analyses.length - 1]?.advies_trainingen_per_week || 3;

  // ---- strength development: main lifts trained at least twice in the period
  const byEx = {};
  for (const w of ws) {
    for (const it of w.items || []) {
      const ex = exercise(it.ex);
      if (!ex.inc || it.group === 'warm' || it.group === 'cool') continue;
      const best = Math.max(0, ...workSets(it).map((s) => e1rm(s.w, s.r)));
      if (best) (byEx[it.ex] ||= []).push({ x: w.started_at, y: best });
    }
  }
  const strength = Object.entries(byEx)
    .filter(([, pts]) => pts.length >= 2)
    .map(([id, pts]) => {
      const first = pts[0].y, last = Math.max(...pts.slice(-2).map((p) => p.y));
      return { id, first, last, pct: ((last - first) / first) * 100, n: pts.length };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  // ---- muscle distribution in period
  const muscleSets = setsPerMuscle(days || 3650);
  const muscleRows = Object.keys(MUSCLES).filter((m) => m !== 'conditie')
    .map((m) => ({ label: MUSCLES[m], value: Math.round(((muscleSets[m] || 0) / Math.max(1, weeks)) * 10) / 10 }));

  const counts = {};
  for (const w of S.workouts) {
    const d = new Date(w.started_at * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  const latestAnalysis = S.analyses[S.analyses.length - 1];

  return [
    h('h2.section-title', 'Lichaam'),
    h('div.stat-row',
      statTile('Gewicht (trend)', curW ? fmtKg(curW) + ' kg' : '—', curW && startW !== null && trend.length > 1 ? delta(curW - startW, { unit: ' kg' }) : null),
      statTile('Per week', perWeek !== null ? (perWeek > 0 ? '+' : '') + fmtKg(Math.round(perWeek * 100) / 100) + ' kg' : '—', perWeek !== null ? 'lineaire trend' : 'min. 3 metingen'),
      statTile('Taille', curWaist ? fmtKg(curWaist) + ' cm' : '—', waistPts.length > 1 ? delta(curWaist - waistPts[0].y, { unit: ' cm', invert: true }) : null),
      statTile('BMI', bmi ? fmtKg(Math.round(bmi * 10) / 10) : '—', bmi ? null : h('a', { href: '#/body' }, 'lengte invullen'))),
    weightAll.length ? h('section.card',
      h('h2', 'Gewicht'),
      lineChart(weightPts, { unit: ' kg', yLabel: 'Gewicht', trend: weightPts.length > 2 ? trend : null }),
      weightPts.length > 2 ? h('div.legend', h('span.faint', 'meting'), h('span', 'gemiddelde 7 dagen')) : null,
      h('p.small.muted', 'Je gewicht schommelt dagelijks 1–2 kg door vocht en eten. Kijk naar de trendlijn, niet naar losse metingen.'))
      : h('section.card', h('p.muted', 'Nog geen gewicht gemeten. '), h('a.btn.ghost', { href: '#/body' }, icon('plus'), ' Meting toevoegen')),
    waistPts.length > 1 ? h('section.card', h('h2', 'Taille'), lineChart(waistPts, { unit: ' cm', yLabel: 'Taille' })) : null,
    latestAnalysis ? analysisCard(latestAnalysis, { compact: true }) : h('a.card.list-row', { href: '#/analysis' },
      h('div', h('strong', 'AI-analyse van je foto\'s'), h('span.muted', 'Laat een AI je sterke punten en aandachtspunten bepalen')), icon('back', 'flip')),

    h('h2.section-title', 'Training'),
    h('div.stat-row',
      statTile('Trainingen', ws.length, Math.round((ws.length / weeks) * 10) / 10 + ' per week'),
      statTile('Tijd', fmtMinutes(totalMin * 60), ws.length ? 'gem. ' + Math.round(totalMin / ws.length) + ' min' : null),
      statTile('Volume', (Math.round(totalVol / 100) / 10).toLocaleString('nl-NL') + ' ton', null),
      statTile('Weken op rij', weekStreak())),
    h('section.card',
      h('h2', 'Trainingen per week'),
      columnChart(weekRows.map((r) => ({ label: r.label, title: r.title, value: r.count })), { target: goalPerWeek }),
      h('p.small.muted', `Stippellijn: doel van ${goalPerWeek}× per week${S.analyses.length ? ' (uit je AI-analyse)' : ''}.`)),
    h('section.card',
      h('h2', 'Volume per week (ton)'),
      columnChart(weekRows.map((r) => ({ label: r.label, title: r.title, value: r.volume })), { unit: ' t' })),
    h('section.card',
      h('h2', 'Krachtontwikkeling'),
      strength.length ? [
        h('p.small.muted', 'Geschatte 1RM: eerste keer in deze periode → nu.'),
        strength.map((x) => h('a.strength-row', { href: '#/exercise/' + x.id },
          h('span', exercise(x.id).name),
          h('span.muted.small', `${fmtKg(Math.round(x.first))} → ${fmtKg(Math.round(x.last))} kg`),
          delta(x.pct, { unit: '%', digits: 0 }))),
      ] : h('p.muted', 'Train oefeningen minstens twee keer in deze periode om hier je ontwikkeling te zien.')),
    h('section.card',
      h('h2', 'Sets per spiergroep per week'),
      h('p.small.muted', 'Gemiddeld over de periode. Streepje: ±10 harde sets per week is een goede richtlijn voor groei.'),
      barList(muscleRows, { target: [10, 20], max: 20 })),
    h('section.card', h('h2', 'Trainingsdagen'), heatmap(counts, 16)),
  ];
}
