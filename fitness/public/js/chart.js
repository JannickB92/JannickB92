// Tiny SVG charts (no library). Colors come from CSS variables so light/dark both work.
import { s, h, fmtDate } from './ui.js';

/**
 * Line chart. points: [{x: unixSeconds, y: number}]
 * trend: optional second series (e.g. moving average), drawn as a smooth bold line; points become faint dots.
 */
export function lineChart(points, { height = 180, unit = '', yLabel = '', trend = null } = {}) {
  if (points.length < 2) {
    return h('div.chart-empty', points.length ? 'Nog maar één meting: na de volgende zie je hier een grafiek.' : 'Nog geen gegevens.');
  }
  const W = 600, H = height, pad = { l: 44, r: 12, t: 12, b: 26 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = y1 - y0 || Math.max(1, y1 * 0.1);
  y0 = Math.max(0, y0 - span * 0.15);
  y1 = y1 + span * 0.15;
  const X = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (y) => H - pad.b - ((y - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);

  const ticks = niceTicks(y0, y1, 4);
  const grid = ticks.map((t) => [
    s('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: 'grid' }),
    s('text', { x: pad.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'axis' }, fmtTick(t)),
  ]);
  const d = points.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  const area = d + ` L${X(x1).toFixed(1)} ${H - pad.b} L${X(x0).toFixed(1)} ${H - pad.b} Z`;
  const best = Math.max(...ys);
  const dots = points.map((p) => s('circle', { cx: X(p.x), cy: Y(p.y), r: p.y === best ? 4.5 : 3, class: p.y === best ? 'dot best' : 'dot' },
    s('title', {}, `${fmtDate(p.x)}: ${fmtTick(p.y)}${unit}`)));
  const labels = [
    s('text', { x: pad.l, y: H - 6, class: 'axis' }, fmtDate(x0, false)),
    s('text', { x: W - pad.r, y: H - 6, 'text-anchor': 'end', class: 'axis' }, fmtDate(x1, false)),
  ];
  if (trend && trend.length > 1) {
    const td = trend.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
    return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart with-trend', role: 'img', 'aria-label': yLabel },
      grid, s('path', { d, class: 'line faint' }), dots, s('path', { d: td, class: 'line trend' }), labels);
  }
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': yLabel },
    grid, s('path', { d: area, class: 'area' }), s('path', { d, class: 'line' }), dots, labels);
}

/** Horizontal bars. rows: [{label, value, hint?}] */
export function barList(rows, { max, unit = '', target } = {}) {
  const m = max || Math.max(1, ...rows.map((r) => r.value));
  return h('div.bars', rows.map((r) => {
    const fill = h('div.bar-fill' + (target && r.value >= target[0] ? '.ok' : ''));
    fill.style.width = Math.min(100, (r.value / m) * 100) + '%';
    let marker = null;
    if (target) {
      marker = h('div.bar-target');
      marker.style.left = Math.min(100, (target[0] / m) * 100) + '%';
    }
    return h('div.bar-row',
      h('div.bar-label', r.label),
      h('div.bar-track', fill, marker),
      h('div.bar-value', fmtTick(r.value) + unit));
  }));
}

/** GitHub-style calendar heatmap of the last N weeks. dates: Set of 'YYYY-MM-DD' */
export function heatmap(counts, weeks = 16) {
  const cell = 14, gap = 3;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
  const rects = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      if (day > today) continue;
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const n = counts[key] || 0;
      rects.push(s('rect', { x: w * (cell + gap), y: d * (cell + gap), width: cell, height: cell, rx: 3, class: 'hm' + Math.min(n, 2) },
        s('title', {}, `${fmtDate(key)}${n ? ' · training' : ''}`)));
    }
  }
  return s('svg', { viewBox: `0 0 ${weeks * (cell + gap)} ${7 * (cell + gap)}`, class: 'heatmap', role: 'img', 'aria-label': 'Trainingsdagen' }, rects);
}

function niceTicks(min, max, count) {
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0 || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s2) => s2 >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function fmtTick(v) {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

/** Vertical columns, e.g. per week. rows: [{label, value, title?}] */
export function columnChart(rows, { height = 140, unit = '', target } = {}) {
  const W = 600, H = height, pad = { l: 8, r: 8, t: 18, b: 22 };
  const max = Math.max(1, target || 0, ...rows.map((r) => r.value));
  const bw = (W - pad.l - pad.r) / rows.length;
  const Y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const cols = rows.map((r, i) => {
    const x = pad.l + i * bw + bw * 0.15;
    const y = Y(r.value);
    return [
      s('rect', { x, y, width: bw * 0.7, height: Math.max(0, H - pad.b - y), rx: 4, class: 'col' + (target && r.value >= target ? ' ok' : '') },
        s('title', {}, `${r.title || r.label}: ${fmtTick(r.value)}${unit}`)),
      r.value ? s('text', { x: x + bw * 0.35, y: y - 4, 'text-anchor': 'middle', class: 'axis' }, fmtTick(r.value)) : null,
      i % Math.ceil(rows.length / 6) === 0 ? s('text', { x: x + bw * 0.35, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, r.label) : null,
    ];
  });
  const tline = target ? s('line', { x1: pad.l, x2: W - pad.r, y1: Y(target), y2: Y(target), class: 'target-line' }) : null;
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' }, tline, cols);
}

/** Time-weighted moving average over `days` (handles irregular measurements). */
export function movingAverage(points, days = 7) {
  return points.map((p) => {
    const win = points.filter((q) => q.x <= p.x && q.x > p.x - days * 86400);
    return { x: p.x, y: Math.round((win.reduce((t, q) => t + q.y, 0) / win.length) * 10) / 10 };
  });
}
