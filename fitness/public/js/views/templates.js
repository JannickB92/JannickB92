// "Trainingen": saved and planned workouts.
import { h, icon, fmtDate, fmtMinutes, todayStr, empty, mount } from '../ui.js';
import { S, exercise, GOALS } from '../store.js';
import { estimate } from '../generator.js';
import { go } from '../app.js';

export function templatesView(root) {
  const today = todayStr();
  const sorted = [...S.templates].sort((a, b) => {
    const pa = a.planned_for && a.planned_for >= today ? a.planned_for : '9999';
    const pb = b.planned_for && b.planned_for >= today ? b.planned_for : '9999';
    return pa.localeCompare(pb) || b.updated_at - a.updated_at;
  });

  mount(root, 
    h('header.page-head', h('h1', 'Mijn trainingen')),
    h('p.muted', 'Bewaar trainingen die je vaker doet, of plan ze in. Tik op een training om hem te bekijken, aan te passen of te starten.'),
    h('button.btn.block', {
      type: 'button',
      onclick: () => { S.draft = { name: 'Nieuwe training', goal: S.settings.goal, focus: '', items: [] }; go('#/builder'); },
    }, icon('plus'), ' Nieuwe training'),
    sorted.length ? h('div.cards', sorted.map((t) => {
      const names = t.items.filter((i) => i.group !== 'warm' && i.group !== 'cool').map((i) => exercise(i.ex).name);
      const isPlanned = t.planned_for && t.planned_for >= today;
      return h('a.card.template-card', { href: '#/builder/' + t.id, onclick: () => (S.draft = null) },
        h('div.row.between',
          h('strong', t.name),
          isPlanned ? h('span.pill' + (t.planned_for === today ? '.today' : ''), icon('calendar'), ' ', t.planned_for === today ? 'Vandaag' : fmtDate(t.planned_for)) : null),
        h('p.small.muted', [t.goal ? GOALS[t.goal] : null, '± ' + fmtMinutes(estimate(t.items)), names.length + ' oefeningen'].filter(Boolean).join(' · ')),
        h('p.small', names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : '')));
    })) : empty('Nog geen opgeslagen trainingen. Stel er één samen via "Vandaag" en kies "Opslaan als training".'),
  );
}
