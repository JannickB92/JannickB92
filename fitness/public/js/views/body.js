// Body: weight / waist log and private progress photos (with side-by-side comparison).
import { h, icon, iconBtn, chips, sheet, toast, fmtDate, fmtKg, todayStr, parseNum, confirmDialog, empty, mount, stepper } from '../ui.js';
import { S, MUSCLES, saveSettings } from '../store.js';
import { api, errorMessage } from '../api.js';
import { lineChart } from '../chart.js';
import { refresh } from '../app.js';

const POSES = { voor: 'Voorkant', zij: 'Zijkant', achter: 'Achterkant', overig: 'Overig' };

function photoUrl(id) {
  return 'api/?r=photos/file&id=' + encodeURIComponent(id);
}

export function bodyView(root) {
  const last = S.body[S.body.length - 1];
  const date = h('input', { type: 'date', value: todayStr(), max: todayStr() });
  const weight = h('input', { type: 'text', inputMode: 'decimal', placeholder: last?.weight ? fmtKg(last.weight) : 'kg' });
  const waist = h('input', { type: 'text', inputMode: 'decimal', placeholder: last?.waist ? fmtKg(last.waist) : 'cm' });
  let metric = 'weight';
  const chartWrap = h('div');
  const renderChart = () => {
    const pts = S.body.filter((b) => b[metric]).map((b) => ({ x: new Date(b.date + 'T12:00:00').getTime() / 1000, y: b[metric] }));
    mount(chartWrap, lineChart(pts, { unit: metric === 'weight' ? ' kg' : ' cm', yLabel: metric === 'weight' ? 'Gewicht' : 'Taille' }));
  };

  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'hidden' });
  let pose = 'voor';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      toast('Foto verkleinen en uploaden…');
      const blob = await resize(f, 1600);
      const form = new FormData();
      form.append('photo', blob, 'photo.jpg');
      form.append('date', todayStr());
      form.append('pose', pose);
      await api('photos/upload', { form });
      await refresh();
      toast('Foto opgeslagen', 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  });

  const byDate = {};
  for (const p of S.photos) (byDate[p.date] ||= []).push(p);
  const dates = Object.keys(byDate).sort().reverse();
  let selected = [];
  const compareBtn = h('button.btn.small', { type: 'button', disabled: true, onclick: () => compare(selected) }, 'Vergelijk (0/2)');
  const updateCompare = () => {
    compareBtn.disabled = selected.length !== 2;
    compareBtn.textContent = `Vergelijk (${selected.length}/2)`;
  };

  mount(root, 
    h('header.page-head', h('h1', 'Lichaam')),
    h('section.card',
      h('div.row.between', h('h2', 'Meting'), h('a.small', { href: '#/results' }, 'Statistieken →')),
      h('div.grid-3',
        h('label.field', h('span', 'Datum'), date),
        h('label.field', h('span', 'Gewicht (kg)'), weight),
        h('label.field', h('span', 'Taille (cm)'), waist)),
      h('button.btn.block', {
        type: 'button',
        onclick: async () => {
          const w = parseNum(weight.value), t = parseNum(waist.value);
          if (w === null && t === null) return toast('Vul gewicht of taille in.');
          try {
            const existing = S.body.find((b) => b.date === date.value);
            await api('body/save', { body: { date: date.value, weight: w ?? existing?.weight ?? null, waist: t ?? existing?.waist ?? null } });
            await refresh();
            toast('Opgeslagen', 'ok');
          } catch (e) { toast(errorMessage(e), 'error'); }
        },
      }, 'Opslaan')),
    h('section.card.compact',
      h('div.field-row', h('span', 'Lengte (voor BMI)'),
        stepper(S.settings.height || 180, { min: 120, max: 230, fmt: (v) => v + ' cm', onChange: (v) => saveSettings({ height: v }).catch(() => {}) }))),
    h('a.card.list-row', { href: '#/analysis' },
      h('div',
        h('strong', '✨ AI-analyse van je foto\'s'),
        h('span.muted', S.analyses.length
          ? `Laatste: ${fmtDate(S.analyses[S.analyses.length - 1].date)} · focus: ${(S.settings.focusMuscles || []).map((m) => MUSCLES[m]).join(', ') || '—'}`
          : 'Laat een AI je sterke punten en aandachtspunten bepalen')),
      icon('back', 'flip')),
    S.body.length ? h('section.card',
      h('h2', 'Verloop'),
      chips([['weight', 'Gewicht'], ['waist', 'Taille']], metric, (v) => { metric = v; renderChart(); }),
      chartWrap,
      h('details',
        h('summary', 'Alle metingen'),
        [...S.body].reverse().map((b) => h('div.list-row',
          h('span', fmtDate(b.date)),
          h('span', [b.weight ? fmtKg(b.weight) + ' kg' : null, b.waist ? fmtKg(b.waist) + ' cm' : null].filter(Boolean).join(' · ')),
          iconBtn('trash', 'Verwijderen', async () => {
            if (!(await confirmDialog('Meting verwijderen?', 'Verwijderen', true))) return;
            await api('body/delete', { body: { id: b.id } }).catch((e) => toast(errorMessage(e), 'error'));
            await refresh();
          }, 'danger-text'))))) : null,
    h('section.card',
      h('h2', 'Voortgangsfoto\'s'),
      h('p.small.muted', 'Privé: foto\'s staan buiten de website-map en zijn alleen te zien als je ingelogd bent. Tip: zelfde plek, licht en tijdstip (bijv. maandagochtend) maakt vergelijken eerlijk.'),
      chips(Object.entries(POSES), pose, (v) => (pose = v)),
      h('div.row.gap',
        h('button.btn.grow', { type: 'button', onclick: () => fileInput.click() }, icon('camera'), ' Foto toevoegen'),
        compareBtn),
      fileInput,
      dates.length ? dates.map((d) => h('div.photo-day',
        h('h3', fmtDate(d)),
        h('div.photo-grid', byDate[d].map((p) => {
          const tile = h('button.photo-tile', {
            type: 'button',
            onclick: () => {
              if (selected.includes(p)) selected = selected.filter((x) => x !== p);
              else selected = [...selected.slice(-1), p];
              root.querySelectorAll('.photo-tile').forEach((t) => t.classList.toggle('selected', selected.some((s) => s.id === +t.dataset.id)));
              updateCompare();
            },
          }, h('img', { src: photoUrl(p.id), alt: `${POSES[p.pose]} ${d}`, loading: 'lazy' }), h('span.photo-pose', POSES[p.pose]));
          tile.dataset.id = p.id;
          tile.addEventListener('contextmenu', (e) => { e.preventDefault(); photoMenu(p); });
          return tile;
        })),
      )) : empty('Nog geen foto\'s.'),
      dates.length ? h('p.small.muted', 'Tik op twee foto\'s en kies "Vergelijk". Lang indrukken of rechtsklikken om te verwijderen.') : null),
  );
  if (S.body.length) renderChart();
}

function photoMenu(p) {
  const sh = sheet('Foto', [
    h('img.photo-full', { src: photoUrl(p.id), alt: '' }),
    h('button.btn.ghost.block.danger-text', {
      type: 'button',
      onclick: async () => {
        if (!(await confirmDialog('Foto definitief verwijderen?', 'Verwijderen', true))) return;
        try {
          await api('photos/delete', { body: { id: p.id } });
          sh.close();
          await refresh();
        } catch (e) { toast(errorMessage(e), 'error'); }
      },
    }, icon('trash'), ' Verwijderen'),
  ]);
}

function compare(sel) {
  const [a, b] = [...sel].sort((x, y) => x.date.localeCompare(y.date));
  const days = Math.round((new Date(b.date) - new Date(a.date)) / 86400000);
  sheet(`Vergelijken · ${days} dagen verschil`, [
    h('div.compare',
      h('figure', h('img', { src: photoUrl(a.id), alt: '' }), h('figcaption', fmtDate(a.date))),
      h('figure', h('img', { src: photoUrl(b.id), alt: '' }), h('figcaption', fmtDate(b.date)))),
  ], { wide: true });
}

/** Downscale in the browser before uploading (saves storage and upload time; no server image library needed). */
async function resize(file, max) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(Object.assign(new Error('not_an_image'), { code: 'not_an_image' }));
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
}
