// Reusable UI pieces: exercise thumbnail, info sheet, picker and plate calculator.
import { h, sheet, chips, icon, fmtKg, mount } from './ui.js';
import { S, exercise, allExercises, imageUrl, MUSCLES, EQUIPMENT, PATTERNS, bests } from './store.js';

export function exThumb(ex, cls = '') {
  const url = imageUrl(ex, 0);
  if (url) return h('img.thumb' + (cls ? '.' + cls : ''), { src: url, alt: '', loading: 'lazy', decoding: 'async' });
  return h('div.thumb.placeholder' + (cls ? '.' + cls : ''), (ex.name || '?').slice(0, 1).toUpperCase());
}

/** Shows start and end position alternately, like a mini animation. */
export function exAnimation(ex) {
  const a = imageUrl(ex, 0), b = imageUrl(ex, 1);
  if (!a) return h('div.ex-anim.placeholder', icon('dumbbell'));
  const img1 = h('img', { src: a, alt: `${ex.name}: startpositie` });
  const img2 = h('img.top', { src: b, alt: `${ex.name}: eindpositie` });
  const wrap = h('div.ex-anim', img1, img2);
  let on = false;
  const iv = setInterval(() => {
    if (!wrap.isConnected) return clearInterval(iv);
    on = !on;
    img2.classList.toggle('visible', on);
  }, 1200);
  return wrap;
}

export function exMeta(ex) {
  return h('div.tags',
    (ex.muscles || []).map((m, i) => h('span.tag' + (i === 0 ? '.primary' : ''), MUSCLES[m] || m)),
    (ex.equip || []).filter((e) => e !== 'bodyweight' || ex.equip.length === 1).map((e) => h('span.tag.outline', EQUIPMENT[e] || e)));
}

export function exerciseInfo(exId) {
  const ex = exercise(exId);
  const b = bests(exId);
  const content = [
    exAnimation(ex),
    exMeta(ex),
    ex.tips?.length ? h('ol.tips', ex.tips.map((t) => h('li', t))) : h('p.muted', 'Geen tips toegevoegd.'),
    ex.link ? h('p', h('a', { href: ex.link, target: '_blank', rel: 'noopener noreferrer' }, 'Bekijk uitleg (video/link)')) : null,
    b.weight || b.reps || b.seconds
      ? h('div.stat-row',
        b.weight ? statTile('Zwaarste', fmtKg(b.weight) + ' kg') : null,
        b.e1rm && ex.inc ? statTile('Geschatte 1RM', fmtKg(Math.round(b.e1rm * 10) / 10) + ' kg') : null,
        !ex.inc && b.reps ? statTile('Meeste reps', b.reps) : null,
        b.seconds ? statTile('Langste', b.seconds + ' s') : null)
      : null,
    h('a.btn.ghost.block', { href: '#/exercise/' + ex.id, onclick: () => sh.close() }, 'Voortgang & geschiedenis'),
  ];
  const sh = sheet(ex.name, content);
  return sh;
}

export function statTile(label, value, sub) {
  return h('div.stat', h('div.stat-value', value), h('div.stat-label', label), sub ? h('div.stat-sub', sub) : null);
}

/**
 * Exercise picker. Resolves with an exercise id or null.
 * @param {{pattern?: string, title?: string, exclude?: string[]}} opts
 */
export function pickExercise({ pattern, title = 'Kies oefening', exclude = [] } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    let query = '';
    let muscle = '';
    let samePattern = !!pattern;
    const list = h('div.ex-list');
    const render = () => {
      const q = query.trim().toLowerCase();
      const items = allExercises()
        .filter((e) => !exclude.includes(e.id))
        .filter((e) => !samePattern || e.pattern === pattern)
        .filter((e) => !muscle || (e.muscles || []).includes(muscle))
        .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.tips || []).join(' ').toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
      mount(list, ...(items.length ? items.map((e) => h('button.ex-row', {
        type: 'button',
        onclick: () => { chosen = e.id; sh.close(); },
      }, exThumb(e), h('div.ex-row-text', h('strong', e.name), h('span.muted', PATTERNS[e.pattern] || ''), exMeta(e)))) : [h('p.muted', 'Geen oefeningen gevonden.')]));
    };
    const search = h('input.search', { type: 'search', placeholder: 'Zoeken…', oninput: (e) => { query = e.target.value; render(); } });
    const sh = sheet(title, [
      search,
      pattern ? h('label.check', h('input', { type: 'checkbox', checked: true, onchange: (e) => { samePattern = e.target.checked; render(); } }), ` Alleen alternatieven (${PATTERNS[pattern] || pattern})`) : null,
      h('div.scroll-x', chips([['', 'Alle'], ...Object.entries(MUSCLES)], '', (v) => { muscle = v; render(); })),
      list,
    ], { onClose: () => resolve(chosen), wide: true });
    render();
    setTimeout(() => !matchMedia('(pointer: coarse)').matches && search.focus(), 50);
  });
}

/** Plates per side for a barbell weight. */
export function platesFor(total, bar = S.settings.barWeight, plates = S.settings.plates) {
  let side = (total - bar) / 2;
  if (side < 0) return null;
  const out = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (side >= p - 1e-9) {
      out.push(p);
      side -= p;
    }
  }
  return { plates: out, rest: Math.round(side * 2 * 100) / 100 };
}

export function plateSheet(weight) {
  const res = h('div.plates');
  const input = h('input.big-input', { type: 'text', inputMode: 'decimal', value: weight ? fmtKg(weight) : '', 'aria-label': 'Totaalgewicht in kg' });
  const render = () => {
    const w = parseFloat(String(input.value).replace(',', '.'));
    const r = Number.isFinite(w) ? platesFor(w) : null;
    if (!r) {
      mount(res, h('p.muted', `Vul een gewicht in van minstens ${S.settings.barWeight} kg (stang).`));
      return;
    }
    mount(res, 
      h('p', `Per kant (stang ${fmtKg(S.settings.barWeight)} kg):`),
      h('div.plate-stack', r.plates.length ? r.plates.map((p) => h('span.plate.p' + String(p).replace('.', '_'), fmtKg(p))) : h('span.muted', 'Alleen de stang')),
      r.rest ? h('p.muted', `Niet exact te maken: ${fmtKg(r.rest)} kg over.`) : null,
    );
  };
  input.addEventListener('input', render);
  render();
  return sheet('Schijvencalculator', [h('label.field', h('span', 'Totaal (kg)'), input), res]);
}
