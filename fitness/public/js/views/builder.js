// Review and edit a workout before starting it, or save it as a reusable / planned training.
import { h, icon, iconBtn, stepper, toast, fmtMinutes, confirmDialog, empty, mount } from '../ui.js';
import { S, exercise, GOALS } from '../store.js';
import { api, errorMessage } from '../api.js';
import { generate, estimate, relabel, withLinks } from '../generator.js';
import { exThumb, exerciseInfo, pickExercise } from '../components.js';
import { go, refresh } from '../app.js';
import { startWorkout } from './workout.js';

export function builderView(root, params) {
  if (params.id) {
    const t = S.templates.find((x) => String(x.id) === params.id);
    if (!t) return mount(root, empty('Training niet gevonden.', h('a.btn', { href: '#/train' }, 'Terug')));
    if (!S.draft || S.draft.id !== t.id) {
      S.draft = { id: t.id, name: t.name, goal: t.goal, focus: t.focus, planned_for: t.planned_for, items: withLinks(t.items.map((i) => ({ ...i }))) };
    }
  }
  if (!S.draft) return go('#/', true);
  const d = S.draft;
  let openIndex = -1;

  const listEl = h('div.builder-list');
  const estEl = h('span');

  const renderList = () => {
    d.items = relabel(d.items);
    estEl.textContent = '± ' + fmtMinutes(estimate(d.items));
    const sections = [
      ['warm', 'Warming-up'],
      ['main', 'Training'],
      ['cool', 'Cooling-down'],
    ];
    mount(listEl, ...sections.map(([key, title]) => {
      const idxs = d.items.map((it, i) => i).filter((i) => (key === 'main' ? !['warm', 'cool'].includes(d.items[i].group) : d.items[i].group === key));
      if (!idxs.length && key !== 'main') return null;
      return h('section.block',
        h('h3', title),
        idxs.map((i) => itemRow(i)),
        h('button.btn.ghost.small', {
          type: 'button',
          onclick: async () => {
            const id = await pickExercise({ title: 'Oefening toevoegen' });
            if (!id) return;
            const ex = exercise(id);
            const group = key === 'main' ? 'Z' : key;
            const item = { ex: id, group, sets: key === 'main' ? 3 : 1, target: ex.reps, rest: key === 'main' ? ex.rest : 0, link: false };
            const last = idxs.length ? idxs[idxs.length - 1] + 1 : (key === 'cool' ? d.items.length : d.items.filter((x) => x.group === 'warm').length);
            d.items.splice(last, 0, item);
            renderList();
          },
        }, icon('plus'), ' Oefening'));
    }));
  };

  const itemRow = (i) => {
    const it = d.items[i];
    const ex = exercise(it.ex);
    const isBlock = it.group === 'warm' || it.group === 'cool';
    const summary = isBlock
      ? `${it.target} s`
      : `${it.sets} × ${ex.type === 'time' ? it.target + ' s' : it.target}${it.rest ? ' · rust ' + it.rest + ' s' : ''}`;
    const open = openIndex === i;
    const row = h('div.b-item' + (it.link ? '.linked' : '') + (open ? '.open' : ''),
      h('div.b-main',
        isBlock ? null : h('span.group-badge', it.group),
        h('button.b-thumb', { type: 'button', 'aria-label': 'Uitleg ' + ex.name, onclick: () => exerciseInfo(ex.id) }, exThumb(ex)),
        h('button.b-text', { type: 'button', onclick: () => { openIndex = open ? -1 : i; renderList(); } },
          h('strong', ex.name), h('span.muted', summary)),
        iconBtn('edit', 'Aanpassen', () => { openIndex = open ? -1 : i; renderList(); })),
      open ? h('div.b-edit',
        isBlock ? null : h('div.field-row', h('span', 'Sets'), stepper(it.sets, { min: 1, max: 10, onChange: (v) => { it.sets = v; refreshSummary(); } })),
        h('div.field-row', h('span', ex.type === 'time' ? 'Seconden' : 'Herhalingen'), stepper(it.target, { min: 1, max: ex.type === 'time' ? 600 : 50, step: ex.type === 'time' ? 5 : 1, onChange: (v) => { it.target = v; refreshSummary(); } })),
        isBlock ? null : h('div.field-row', h('span', 'Rust (s)'), stepper(it.rest, { min: 0, max: 300, step: 15, onChange: (v) => { it.rest = v; refreshSummary(); } })),
        h('div.row.wrap',
          h('button.btn.small.ghost', { type: 'button', disabled: i === 0, onclick: () => move(i, -1) }, icon('up'), ' Omhoog'),
          h('button.btn.small.ghost', { type: 'button', disabled: i === d.items.length - 1, onclick: () => move(i, 1) }, icon('down'), ' Omlaag'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => swap(i) }, icon('swap'), ' Wissel'),
          isBlock ? null : h('button.btn.small.ghost', { type: 'button', onclick: () => { it.link = !it.link; renderList(); } }, icon('link'), it.link ? ' Superset los' : ' Superset met volgende'),
          h('button.btn.small.ghost.danger-text', { type: 'button', onclick: () => { d.items.splice(i, 1); openIndex = -1; renderList(); } }, icon('trash'), ' Verwijder'))) : null);
    return row;
  };

  const refreshSummary = () => {
    estEl.textContent = '± ' + fmtMinutes(estimate(d.items));
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= d.items.length) return;
    [d.items[i], d.items[j]] = [d.items[j], d.items[i]];
    // keep block membership of the moved item consistent with its new neighbours
    const a = d.items[j];
    const nb = d.items[i];
    if ((a.group === 'warm' || a.group === 'cool') !== (nb.group === 'warm' || nb.group === 'cool')) {
      [d.items[i], d.items[j]] = [d.items[j], d.items[i]];
      return;
    }
    openIndex = j;
    renderList();
  };

  const swap = async (i) => {
    const it = d.items[i];
    const ex = exercise(it.ex);
    const id = await pickExercise({ pattern: ex.pattern, title: 'Wissel ' + ex.name, exclude: [it.ex] });
    if (!id) return;
    const nex = exercise(id);
    it.ex = id;
    if (nex.type !== ex.type) it.target = nex.reps;
    renderList();
  };

  const nameInput = h('input.title-input', { value: d.name || '', 'aria-label': 'Naam van de training', oninput: (e) => (d.name = e.target.value) });
  const dateInput = h('input', { type: 'date', value: d.planned_for || '', onchange: (e) => (d.planned_for = e.target.value || null) });

  const save = async () => {
    try {
      const body = { template: { id: d.id, name: d.name, goal: d.goal, focus: d.focus, planned_for: d.planned_for || null, items: d.items } };
      const res = await api('templates/save', { body });
      d.id = res.id;
      await refresh();
      toast('Training opgeslagen', 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  mount(root, 
    h('header.page-head',
      iconBtn('back', 'Terug', () => history.back()),
      h('div.grow', nameInput, h('p.muted', d.goal ? GOALS[d.goal] + ' · ' : '', estEl))),
    d.generated ? h('div.row.gap',
      h('button.btn.ghost.small', {
        type: 'button',
        onclick: () => {
          const g = generate({ ...d.generated, warmup: S.settings.warmup, cooldown: S.settings.cooldown, seed: Date.now() });
          Object.assign(d, { name: g.name, items: withLinks(g.items), focus: g.focus });
          nameInput.value = d.name;
          renderList();
        },
      }, icon('dice'), ' Andere oefeningen'),
      h('span.small.muted', 'Tip: tik op een oefening om sets, reps of rust aan te passen.')) : null,
    listEl,
    h('section.card.compact',
      h('label.field-row', h('span', icon('calendar'), ' Inplannen op'), dateInput),
      h('div.row.gap',
        h('button.btn.ghost.grow', { type: 'button', onclick: save }, d.id ? 'Wijzigingen opslaan' : 'Opslaan als training'),
        d.id ? iconBtn('trash', 'Verwijderen', async () => {
          if (!(await confirmDialog(`"${d.name}" verwijderen?`, 'Verwijderen', true))) return;
          try {
            await api('templates/delete', { body: { id: d.id } });
            S.draft = null;
            await refresh();
            go('#/train', true);
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        }, 'danger-text') : null)),
    h('div.sticky-actions',
      h('button.btn.block.big', {
        type: 'button',
        onclick: async () => {
          if (!d.items.length) return toast('Voeg eerst een oefening toe.');
          if (S.active && !(await confirmDialog('Er loopt al een training. Die vervangen?', 'Vervangen', true))) return;
          startWorkout(d);
        },
      }, icon('play'), ' Start training')),
  );
  renderList();
}
