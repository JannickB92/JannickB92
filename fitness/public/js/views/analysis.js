// AI body analysis without an API key: the app writes a prompt with a strict JSON answer format,
// you share photos + prompt with any AI app, paste the answer back, and the app validates and uses it.
import { h, icon, iconBtn, toast, fmtDate, fmtKg, todayStr, confirmDialog, empty, mount } from '../ui.js';
import { S, MUSCLES, GOALS, saveSettings } from '../store.js';
import { api, errorMessage } from '../api.js';
import { refresh, go } from '../app.js';

const POSES = { voor: 'voorkant', zij: 'zijkant', achter: 'achterkant', overig: 'overig' };
const MUSCLE_KEYS = Object.keys(MUSCLES).filter((m) => m !== 'conditie');

// The answer format. Kept in one place: the prompt shows it, the parser enforces it.
const FORMAT_EXAMPLE = {
  versie: 1,
  samenvatting: 'Twee zinnen over het totaalbeeld.',
  sterke_punten: ['Korte zin', 'Korte zin'],
  aandachtspunten: [
    { spiergroep: 'schouders', prioriteit: 1, reden: 'Korte uitleg waarom.' },
    { spiergroep: 'hamstrings', prioriteit: 2, reden: 'Korte uitleg waarom.' },
  ],
  houding: ['Korte observatie over houding, of lege lijst'],
  advies_doel: 'spiermassa',
  advies_trainingen_per_week: 3,
  vetpercentage_indicatie: { min: 15, max: 18 },
  vergelijking_vorige: 'Wat veranderd is t.o.v. de vorige analyse, of null',
  tips: ['Concrete trainingstip', 'Concrete trainingstip'],
};

function photoUrl(id) {
  return 'api/?r=photos/file&id=' + encodeURIComponent(id);
}

/** Default selection: all photos of the most recent photo date. */
function latestPhotos() {
  if (!S.photos.length) return [];
  const last = S.photos[S.photos.length - 1].date;
  return S.photos.filter((p) => p.date === last);
}

export function buildPrompt(photos) {
  const weight = [...S.body].reverse().find((b) => b.weight);
  const waist = [...S.body].reverse().find((b) => b.waist);
  const since = Date.now() / 1000 - 28 * 86400;
  const recent = S.workouts.filter((w) => w.started_at >= since).length;
  const prev = S.analyses[S.analyses.length - 1];
  const poses = photos.map((p) => POSES[p.pose] || p.pose).join(', ');

  const facts = [
    S.settings.height ? `lengte ${S.settings.height} cm` : null,
    weight ? `gewicht ${fmtKg(weight.weight)} kg (${weight.date})` : null,
    waist ? `taille ${fmtKg(waist.waist)} cm` : null,
    `huidig trainingsdoel: ${GOALS[S.settings.goal] || S.settings.goal}`,
    `${recent} krachttrainingen in de afgelopen 4 weken`,
    'ik heb weinig tijd en wil sterk, atletisch en lenig blijven',
  ].filter(Boolean);

  const lines = [
    'Je bent een ervaren krachttrainer en fysiek coach.',
    `Ik stuur je ${photos.length} foto${photos.length === 1 ? '' : "'s"} van mijn lichaam (${poses}), genomen op ${photos[0]?.date || todayStr()}.`,
    `Over mij: ${facts.join('; ')}.`,
  ];
  if (prev) {
    lines.push('', `Je vorige analyse (${prev.date}): ${prev.samenvatting}`,
      `Aandachtspunten toen: ${(prev.aandachtspunten || []).map((a) => `${a.spiergroep} (prio ${a.prioriteit})`).join(', ') || 'geen'}.`);
  }
  lines.push(
    '',
    'Opdracht:',
    '1. Beoordeel objectief de spierontwikkeling en de balans (links/rechts, boven-/onderlichaam, voor-/achterkant) en de houding.',
    '2. Bepaal welke spiergroepen de meeste extra aandacht verdienen voor een evenwichtig, sterk en atletisch lichaam.',
    '3. Geef alleen een voorzichtige indicatie van het vetpercentage (als bereik) als de foto\'s dat toelaten, anders null.',
    prev ? '4. Vergelijk met de vorige analyse.' : '4. Er is geen vorige analyse: zet "vergelijking_vorige" op null.',
    'Wees eerlijk en concreet, maar respectvol. Stel geen medische diagnoses; als iets mogelijk op een blessure of medisch probleem wijst, zeg dan alleen dat ik dat door een professional moet laten bekijken.',
    '',
    'Antwoord UITSLUITEND met één geldig JSON-object in exact dit formaat, zonder tekst ervoor of erna:',
    JSON.stringify(FORMAT_EXAMPLE, null, 2),
    '',
    'Regels voor het JSON-antwoord:',
    `- "spiergroep" is altijd precies één van: ${MUSCLE_KEYS.join(', ')}.`,
    '- "prioriteit" is 1, 2 of 3 (1 = belangrijkst). Maximaal 4 aandachtspunten.',
    `- "advies_doel" is precies één van: ${Object.keys(GOALS).join(', ')}.`,
    '- "advies_trainingen_per_week" is een geheel getal van 2 t/m 5.',
    '- "vetpercentage_indicatie" is {"min": getal, "max": getal} of null.',
    '- "vergelijking_vorige" is een tekst of null.',
    '- Alle teksten in het Nederlands, kort (maximaal 2 zinnen per tekst).',
  );
  return lines.join('\n');
}

const clip = (v, n = 400) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const strList = (v, max = 6) => (Array.isArray(v) ? v.map((x) => clip(x, 300)).filter(Boolean).slice(0, max) : []);

/** Extracts the JSON from an AI answer (tolerates code fences / extra text) and validates it strictly. */
export function parseAnswer(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Geen JSON gevonden in het antwoord.');
  let raw;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Het antwoord is geen geldige JSON. Vraag de AI: "Geef alleen het JSON-object."');
  }
  const samenvatting = clip(raw.samenvatting, 600);
  if (!samenvatting) throw new Error('"samenvatting" ontbreekt.');
  const aandachtspunten = (Array.isArray(raw.aandachtspunten) ? raw.aandachtspunten : [])
    .map((a) => ({
      spiergroep: String(a?.spiergroep || '').toLowerCase().trim(),
      prioriteit: Math.min(3, Math.max(1, Math.round(+a?.prioriteit || 2))),
      reden: clip(a?.reden, 300),
    }))
    .filter((a) => MUSCLE_KEYS.includes(a.spiergroep))
    .sort((a, b) => a.prioriteit - b.prioriteit)
    .slice(0, 4);
  const vet = raw.vetpercentage_indicatie;
  const vMin = +vet?.min, vMax = +vet?.max;
  return {
    versie: 1,
    samenvatting,
    sterke_punten: strList(raw.sterke_punten),
    aandachtspunten,
    houding: strList(raw.houding),
    advies_doel: GOALS[raw.advies_doel] ? raw.advies_doel : null,
    advies_trainingen_per_week: Number.isFinite(+raw.advies_trainingen_per_week) ? Math.min(7, Math.max(1, Math.round(+raw.advies_trainingen_per_week))) : null,
    vetpercentage_indicatie: vet && Number.isFinite(vMin) && Number.isFinite(vMax) && vMin >= 3 && vMax <= 60 && vMin <= vMax ? { min: vMin, max: vMax } : null,
    vergelijking_vorige: clip(raw.vergelijking_vorige, 600) || null,
    tips: strList(raw.tips),
  };
}

/** Rendered as text nodes only: AI output can never inject markup. */
export function analysisCard(a, { compact = false, actions = true } = {}) {
  const focus = (a.aandachtspunten || []).map((x) => x.spiergroep);
  const applied = focus.length && JSON.stringify(focus) === JSON.stringify(S.settings.focusMuscles || []);
  return h('section.card.analysis',
    h('div.row.between', h('h2', 'AI-analyse'), h('span.muted.small', fmtDate(a.date))),
    h('p', a.samenvatting),
    a.aandachtspunten?.length ? h('div',
      h('h3', 'Aandachtspunten'),
      a.aandachtspunten.map((x) => h('div.focus-row',
        h('span.prio.p' + x.prioriteit, x.prioriteit),
        h('div', h('strong', MUSCLES[x.spiergroep] || x.spiergroep), compact ? null : h('p.small.muted', x.reden))))) : null,
    !compact && a.sterke_punten?.length ? h('div', h('h3', 'Sterke punten'), h('ul', a.sterke_punten.map((t) => h('li', t)))) : null,
    !compact && a.houding?.length ? h('div', h('h3', 'Houding'), h('ul', a.houding.map((t) => h('li', t)))) : null,
    !compact && a.vergelijking_vorige ? h('div', h('h3', 'Vergeleken met vorige keer'), h('p', a.vergelijking_vorige)) : null,
    !compact && a.tips?.length ? h('div', h('h3', 'Tips'), h('ul', a.tips.map((t) => h('li', t)))) : null,
    !compact ? h('div.tags',
      a.advies_doel ? h('span.tag.primary', 'Advies: ' + GOALS[a.advies_doel]) : null,
      a.advies_trainingen_per_week ? h('span.tag', a.advies_trainingen_per_week + '× per week') : null,
      a.vetpercentage_indicatie ? h('span.tag', `Vet ± ${a.vetpercentage_indicatie.min}–${a.vetpercentage_indicatie.max}% (indicatie)`) : null) : null,
    actions && focus.length ? (applied
      ? h('p.small.ok-text', icon('check'), ' Wordt gebruikt als extra aandacht in de trainingsgenerator.')
      : h('button.btn.block', {
        type: 'button',
        onclick: async () => {
          await saveSettings({ focusMuscles: focus, ...(a.advies_doel ? { goal: a.advies_doel } : {}) }).catch((e) => toast(errorMessage(e), 'error'));
          toast('Trainingsfocus bijgewerkt 💪', 'ok');
          go(location.hash);
        },
      }, 'Gebruik als trainingsfocus')) : null,
  );
}

export function analysisView(root) {
  let selected = latestPhotos();
  const latest = S.analyses[S.analyses.length - 1];

  const photoPicker = h('div.photo-grid');
  const renderPicker = () => mount(photoPicker, S.photos.slice(-12).reverse().map((p) => {
    const on = selected.some((s) => s.id === p.id);
    return h('button.photo-tile' + (on ? '.selected' : ''), {
      type: 'button',
      onclick: () => {
        selected = on ? selected.filter((s) => s.id !== p.id) : [...selected, p].slice(-4);
        renderPicker();
      },
    }, h('img', { src: photoUrl(p.id), alt: '', loading: 'lazy' }), h('span.photo-pose', `${POSES[p.pose]} · ${fmtDate(p.date, false)}`));
  }));
  renderPicker();

  const getFiles = async () => Promise.all(selected.map(async (p, i) => {
    const res = await fetch(photoUrl(p.id), { credentials: 'same-origin' });
    const blob = await res.blob();
    return new File([blob], `lichaam-${p.date}-${p.pose}-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' });
  }));

  const copyPrompt = async () => {
    if (!selected.length) return toast('Kies eerst één of meer foto\'s.');
    promptBox.value = buildPrompt(selected);
    try {
      await navigator.clipboard.writeText(promptBox.value);
      toast('Prompt gekopieerd ✔', 'ok');
    } catch {
      promptBox.classList.remove('hidden');
      promptBox.select();
      toast('Kopiëren lukte niet: selecteer de tekst hieronder.');
    }
  };

  const share = async () => {
    if (!selected.length) return toast('Kies eerst één of meer foto\'s.');
    try {
      const files = await getFiles();
      const text = buildPrompt(selected);
      await navigator.clipboard?.writeText(text).catch(() => {});
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ files, text, title: 'Lichaamsanalyse' });
        toast('Plak de prompt (staat ook op je klembord) als die niet is meegekomen.');
      } else {
        for (const f of files) {
          const a = h('a', { href: URL.createObjectURL(f), download: f.name });
          document.body.append(a);
          a.click();
          a.remove();
        }
        toast('Foto\'s gedownload en prompt gekopieerd.', 'ok');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Delen lukte niet: ' + (e?.message || e), 'error');
    }
  };

  const promptBox = h('textarea.prompt-box.hidden', { rows: 8, readOnly: true });
  const answer = h('textarea', { rows: 6, placeholder: 'Plak hier het volledige antwoord van de AI…' });
  const preview = h('div');
  let parsed = null;

  const check = () => {
    try {
      parsed = parseAnswer(answer.value);
      mount(preview, analysisCard({ ...parsed, date: selected[0]?.date || todayStr() }, { actions: false }),
        h('button.btn.block.big', {
          type: 'button',
          onclick: async () => {
            try {
              await api('analyses/save', { body: { analysis: { ...parsed, date: selected[0]?.date || todayStr() } } });
              const focus = parsed.aandachtspunten.map((x) => x.spiergroep);
              if (focus.length) await saveSettings({ focusMuscles: focus }).catch(() => {});
              await refresh();
              toast('Analyse opgeslagen en trainingsfocus bijgewerkt', 'ok');
              go('#/analysis');
            } catch (e) { toast(errorMessage(e), 'error'); }
          },
        }, 'Opslaan en gebruiken'));
    } catch (e) {
      parsed = null;
      mount(preview, h('p.error', e.message));
    }
  };

  mount(root,
    h('header.page-head', iconBtn('back', 'Terug', () => go('#/body')), h('div.grow', h('h1', 'AI-analyse van je lichaam'))),
    latest ? analysisCard(latest) : null,
    h('section.card',
      h('h2', latest ? 'Nieuwe analyse' : 'Zo werkt het'),
      h('ol.steps',
        h('li', 'Kies hieronder je foto\'s (bij voorkeur voor, zij en achter, zelfde licht en houding).'),
        h('li', 'Tik op "Deel met AI-app" en kies bijvoorbeeld Claude of ChatGPT. Op je computer: foto\'s worden gedownload en de prompt gekopieerd; sleep ze in de chat en plak de prompt.'),
        h('li', 'Kopieer het antwoord van de AI en plak het hieronder. De app controleert het en past je trainingsfocus aan.')),
      S.photos.length ? [
        photoPicker,
        h('div.row.gap',
          h('button.btn.grow', { type: 'button', onclick: share }, icon('camera'), ' Deel met AI-app'),
          h('button.btn.ghost.grow', { type: 'button', onclick: copyPrompt }, 'Kopieer prompt')),
        promptBox,
        h('p.small.muted', 'Privacy: je foto\'s gaan alleen naar de AI-dienst die jij kiest, op het moment dat jij deelt. De app zelf stuurt niets door.'),
      ] : empty('Voeg eerst voortgangsfoto\'s toe op de pagina Lichaam.', h('a.btn', { href: '#/body' }, 'Naar Lichaam'))),
    S.photos.length ? h('section.card',
      h('h2', 'Antwoord van de AI'),
      answer,
      h('button.btn.ghost.block', { type: 'button', onclick: check }, 'Controleren'),
      preview) : null,
    S.analyses.length > 1 ? h('section.card',
      h('h2', 'Eerdere analyses'),
      [...S.analyses].reverse().slice(1).map((a) => h('details',
        h('summary', `${fmtDate(a.date)} · ${(a.aandachtspunten || []).map((x) => MUSCLES[x.spiergroep]).join(', ')}`),
        analysisCard(a, { actions: false }),
        h('button.btn.small.ghost.danger-text', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmDialog('Deze analyse verwijderen?', 'Verwijderen', true))) return;
            await api('analyses/delete', { body: { id: a.id } }).catch((e) => toast(errorMessage(e), 'error'));
            await refresh();
            go('#/analysis');
          },
        }, 'Verwijderen')))) : null,
  );
}
