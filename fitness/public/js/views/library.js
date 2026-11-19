// Exercise library + creating your own exercises.
import { h, icon, chips, sheet, toast, confirmDialog, mount } from '../ui.js';
import { S, allExercises, MUSCLES, EQUIPMENT, PATTERNS } from '../store.js';
import { exThumb, exMeta } from '../components.js';
import { api, errorMessage } from '../api.js';
import { refresh } from '../app.js';

export function libraryView(root) {
  let query = '';
  let muscle = '';
  const list = h('div.ex-list');
  const render = () => {
    const q = query.trim().toLowerCase();
    const items = allExercises()
      .filter((e) => !muscle || (e.muscles || []).includes(muscle))
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    mount(list, ...items.map((e) => h('div.ex-row-wrap',
      h('a.ex-row', { href: '#/exercise/' + e.id }, exThumb(e),
        h('div.ex-row-text', h('strong', e.name, e.custom ? h('span.tag.outline', 'eigen') : null), h('span.muted', PATTERNS[e.pattern] || ''), exMeta(e))),
      e.custom ? h('button.icon-btn', { type: 'button', 'aria-label': 'Bewerken', onclick: () => customForm(e) }, icon('edit')) : null)));
  };
  mount(root, 
    h('header.page-head', h('h1', 'Oefeningen')),
    h('div.row.gap',
      h('input.search.grow', { type: 'search', placeholder: 'Zoeken…', oninput: (e) => { query = e.target.value; render(); } }),
      h('button.btn', { type: 'button', onclick: () => customForm() }, icon('plus'), ' Eigen')),
    h('div.scroll-x', chips([['', 'Alle'], ...Object.entries(MUSCLES)], '', (v) => { muscle = v; render(); })),
    list,
    h('p.small.muted', 'Afbeeldingen: free-exercise-db (publiek domein).'),
  );
  render();
}

function slug(s) {
  return 'c_' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) + '_' + Math.random().toString(36).slice(2, 6);
}

export function customForm(existing) {
  const e = existing ? { ...existing } : { name: '', pattern: 'other', muscles: [], equip: ['bodyweight'], type: 'reps', reps: 10, rest: 90, inc: 2.5, tips: [], link: '' };
  const name = h('input', { value: e.name, required: true, maxLength: 80 });
  const pattern = h('select', Object.entries(PATTERNS).map(([k, v]) => h('option', { value: k, selected: k === e.pattern }, v)));
  const reps = h('input', { type: 'number', min: 1, max: 600, value: e.reps });
  const rest = h('input', { type: 'number', min: 0, max: 600, step: 15, value: e.rest });
  const inc = h('input', { type: 'number', min: 0, max: 20, step: 0.25, value: e.inc });
  const tips = h('textarea', { rows: 4, placeholder: 'Eén tip per regel', value: (e.tips || []).join('\n') });
  const link = h('input', { type: 'url', placeholder: 'https://… (bijv. YouTube)', value: e.link || '' });
  const repsLabel = h('span', e.type === 'time' ? 'Standaard seconden' : 'Standaard herhalingen');

  const sh = sheet(existing ? 'Oefening bewerken' : 'Eigen oefening', [
    h('label.field', h('span', 'Naam'), name),
    h('label.field', h('span', 'Soort beweging (voor wisselen & generator)'), pattern),
    h('div.field', h('span.label', 'Spiergroepen (eerste = belangrijkste)'), chips(Object.entries(MUSCLES), e.muscles, (v) => (e.muscles = v), { multi: true })),
    h('div.field', h('span.label', 'Materiaal'), chips(Object.entries(EQUIPMENT), e.equip, (v) => (e.equip = v), { multi: true })),
    h('div.field', h('span.label', 'Type'), chips([['reps', 'Herhalingen'], ['time', 'Tijd']], e.type, (v) => { e.type = v; repsLabel.textContent = v === 'time' ? 'Standaard seconden' : 'Standaard herhalingen'; })),
    h('div.grid-3',
      h('label.field', repsLabel, reps),
      h('label.field', h('span', 'Rust (s)'), rest),
      h('label.field', h('span', 'Stapgrootte kg (0 = geen gewicht)'), inc)),
    h('label.field', h('span', 'Tips'), tips),
    h('label.field', h('span', 'Link naar uitleg'), link),
    h('div.row.gap',
      existing ? h('button.btn.ghost.danger-text', {
        type: 'button',
        onclick: async () => {
          if (!(await confirmDialog(`"${e.name}" verwijderen? Je geschiedenis blijft bewaard.`, 'Verwijderen', true))) return;
          try {
            await api('custom/delete', { body: { id: e.id } });
            await refresh();
            sh.close();
          } catch (err) { toast(errorMessage(err), 'error'); }
        },
      }, 'Verwijderen') : null,
      h('button.btn.grow', {
        type: 'button',
        onclick: async () => {
          if (!name.value.trim()) return toast('Geef de oefening een naam.');
          const ex = {
            ...e,
            id: e.id || slug(name.value),
            name: name.value.trim(),
            pattern: pattern.value,
            reps: +reps.value || 10,
            rest: +rest.value || 0,
            inc: +inc.value || 0,
            tips: tips.value.split('\n').map((t) => t.trim()).filter(Boolean),
            link: link.value.trim(),
          };
          if (!ex.muscles.length) ex.muscles = ['core'];
          if (!ex.equip.length) ex.equip = ['bodyweight'];
          try {
            await api('custom/save', { body: { exercise: ex } });
            await refresh();
            toast('Oefening opgeslagen', 'ok');
            sh.close();
          } catch (err) { toast(errorMessage(err), 'error'); }
        },
      }, 'Opslaan')),
  ]);
  if (S.settings) name.focus();
}
