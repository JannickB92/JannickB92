// "Vandaag": continue / planned workouts / generate a new one.
import { h, chips, icon, sheet, fmtDate, fmtDuration, todayStr, toast, mount } from '../ui.js';
import { S, GOALS, EQUIPMENT, MUSCLES, saveSettings, weekStreak, startOfWeek, suggestedFocusMuscle } from '../store.js';
import { generate, resolveFocus, FOCUS_LABELS, withLinks } from '../generator.js';
import { go } from '../app.js';
import { statTile } from '../components.js';

export function homeView(root) {
  const st = S.settings;
  const opts = { goal: st.goal, minutes: st.minutes, focus: st.focus || 'auto', extraMuscle: suggestedFocusMuscle() };
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond';

  const today = todayStr();
  const planned = S.templates.filter((t) => t.planned_for && t.planned_for >= today).sort((a, b) => a.planned_for.localeCompare(b.planned_for));

  const focusHint = h('p.small.muted');
  const updateHint = () => {
    focusHint.textContent = opts.focus === 'auto' ? `Volgende in de rotatie: ${FOCUS_LABELS[resolveFocus('auto')]}.` : '';
  };
  updateHint();

  const equipSummary = h('span');
  const renderEquip = () => (equipSummary.textContent = S.settings.equipment.length ? S.settings.equipment.map((e) => EQUIPMENT[e]).join(', ') : 'Alleen eigen gewicht');
  renderEquip();

  const persist = () => saveSettings({ goal: opts.goal, minutes: opts.minutes, focus: opts.focus }).catch(() => {});

  const generator = h('section.card.generator',
    h('h2', 'Nieuwe training'),
    h('div.field', h('span.label', 'Doel'), chips(Object.entries(GOALS), opts.goal, (v) => { opts.goal = v; persist(); })),
    h('div.field', h('span.label', 'Tijd'), chips([[20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '60 min']], opts.minutes, (v) => { opts.minutes = v; persist(); })),
    h('div.field', h('span.label', 'Focus'), chips([['auto', 'Automatisch'], ['full', 'Volledig'], ['upper', 'Boven'], ['lower', 'Onder']], opts.focus, (v) => { opts.focus = v; updateHint(); persist(); }), focusHint),
    h('label.field', h('span.label', 'Extra aandacht voor (optioneel)'),
      h('select', { onchange: (e) => (opts.extraMuscle = e.target.value) },
        h('option', { value: '' }, '—'),
        Object.entries(MUSCLES).filter(([k]) => !['conditie', 'heupen'].includes(k)).map(([k, v]) => h('option', { value: k, selected: k === opts.extraMuscle }, v + ((S.settings.focusMuscles || []).includes(k) ? ' ✨' : ''))))),
    S.settings.focusMuscles?.length ? h('p.small.muted', '✨ = aandachtspunt uit je AI-analyse. De app kiest steeds degene die deze week het minst getraind is.') : null,
    h('button.linkish', { type: 'button', onclick: () => equipmentSheet(renderEquip) }, icon('dumbbell'), ' Materiaal: ', equipSummary),
    h('button.btn.block.big', {
      type: 'button',
      onclick: () => {
        const seed = Date.now();
        const g = generate({ ...opts, equipment: S.settings.equipment, warmup: S.settings.warmup, cooldown: S.settings.cooldown, seed });
        S.draft = { ...g, items: withLinks(g.items), generated: { ...opts, equipment: S.settings.equipment } };
        go('#/builder');
      },
    }, 'Stel training samen'),
  );

  const thisWeek = S.workouts.filter((w) => w.started_at * 1000 >= startOfWeek().getTime()).length;
  const last = S.workouts[S.workouts.length - 1];

  mount(root, 
    h('header.page-head', h('div', h('p.muted', fmtDate(today)), h('h1', `${greet}${S.user ? ', ' + S.user.username : ''}`))),
    S.active ? h('a.card.active-card', { href: '#/workout' },
      h('div', h('strong', 'Training bezig'), h('p.muted', S.active.name)),
      h('span.pill', fmtDuration(Date.now() / 1000 - S.active.started_at)), icon('play')) : null,
    planned.length ? h('section.card',
      h('h2', 'Ingepland'),
      planned.slice(0, 3).map((t) => h('a.list-row', { href: '#/builder/' + t.id },
        h('div', h('strong', t.name), h('span.muted', t.planned_for === today ? 'Vandaag' : fmtDate(t.planned_for))),
        icon('back', 'flip')))) : null,
    generator,
    h('div.row.gap',
      h('button.btn.ghost.grow', { type: 'button', onclick: () => { S.draft = { name: 'Eigen training', goal: st.goal, focus: '', items: [] }; go('#/builder'); } }, icon('plus'), ' Zelf samenstellen'),
      h('a.btn.ghost.grow', { href: '#/train' }, icon('list'), ' Mijn trainingen')),
    h('div.stat-row',
      statTile('Deze week', thisWeek),
      statTile('Weken op rij', weekStreak()),
      statTile('Laatste', last ? fmtDate(last.started_at, false) : '—')),
  );
}

function equipmentSheet(onChange) {
  let value = [...S.settings.equipment];
  sheet('Beschikbaar materiaal', [
    h('p.muted', 'De generator kiest alleen oefeningen waarvoor je het materiaal hebt. Eigen gewicht kan altijd.'),
    chips(Object.entries(EQUIPMENT).filter(([k]) => k !== 'bodyweight'), value, (v) => {
      value = v;
      saveSettings({ equipment: v }).catch(() => toast('Opgeslagen op dit apparaat; synchroniseert later.'));
      onChange();
    }, { multi: true }),
  ]);
}
