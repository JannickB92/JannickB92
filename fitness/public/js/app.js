// App shell: boot, auth gate, hash router and bottom navigation.
import { h, icon, toast, fmtDuration, mount } from './ui.js';
import { api, setUnauthorizedHandler, flushOutbox } from './api.js';
import { S, loadCatalog, loadCache, sync, loadActive, clearCache } from './store.js';
import { restoreTimer, unlockAudio } from './timer.js';
import { authView } from './views/auth.js';
import { homeView } from './views/home.js';
import { builderView } from './views/builder.js';
import { workoutView } from './views/workout.js';
import { templatesView } from './views/templates.js';
import { resultsView, workoutDetailView, exerciseView } from './views/results.js';
import { libraryView } from './views/library.js';
import { bodyView } from './views/body.js';
import { settingsView } from './views/settings.js';

export const APP_VERSION = '1.0.0';

const ROUTES = [
  [/^#?\/?$/, homeView, 'home'],
  [/^#\/train$/, templatesView, 'train'],
  [/^#\/builder$/, builderView, 'train'],
  [/^#\/builder\/(?<id>\d+)$/, builderView, 'train'],
  [/^#\/workout$/, workoutView, 'workout'],
  [/^#\/results$/, resultsView, 'results'],
  [/^#\/workouts\/(?<id>[\w-]+)$/, workoutDetailView, 'results'],
  [/^#\/exercise\/(?<id>[\w-]+)$/, exerciseView, 'results'],
  [/^#\/library$/, libraryView, 'more'],
  [/^#\/body$/, bodyView, 'body'],
  [/^#\/settings$/, settingsView, 'more'],
];

const NAV = [
  ['home', '#/', 'home', 'Vandaag'],
  ['train', '#/train', 'list', 'Trainingen'],
  ['results', '#/results', 'chart', 'Resultaten'],
  ['body', '#/body', 'body', 'Lichaam'],
  ['more', '#/settings', 'more', 'Meer'],
];

const app = document.getElementById('app');
const main = h('main');
main.id = 'view';
const nav = h('nav.bottom-nav', { 'aria-label': 'Hoofdmenu' });
const activePill = h('a.active-pill', { href: '#/workout' });
let started = false;

/** Navigate to a hash route; re-renders when the hash is already current. */
export function go(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) render();
  else location.hash = hash;
}

/** Reload all data from the server (falls back silently when offline). */
export async function refresh() {
  try {
    await sync();
    S.offline = false;
  } catch (e) {
    if (e.code === 'network') S.offline = true;
    else throw e;
  }
  updateChrome();
}

function render() {
  // Close any open sheets on navigation.
  document.querySelectorAll('.backdrop').forEach((b) => b.remove());
  const hash = location.hash || '#/';
  let view = homeView, section = 'home', params = {};
  for (const [re, fn, sec] of ROUTES) {
    const m = re.exec(hash);
    if (m) {
      view = fn;
      section = sec;
      params = m.groups || {};
      break;
    }
  }
  mount(main);
  main.className = 'view-' + section;
  view(main, params);
  updateChrome(section);
  window.scrollTo(0, 0);
}

let pillTimer;
function updateChrome(section = document.body.dataset.section) {
  document.body.dataset.section = section || '';
  mount(nav, ...NAV.map(([key, href, ic, label]) =>
    h('a' + (key === section ? '.on' : ''), { href, 'aria-current': key === section ? 'page' : null }, icon(ic), h('span', label))));
  document.body.classList.toggle('offline', S.offline);
  clearInterval(pillTimer);
  if (S.active && section !== 'workout') {
    const upd = () => (mount(activePill, icon('play'), ` Training bezig · ${fmtDuration(Date.now() / 1000 - S.active.started_at)}`));
    upd();
    pillTimer = setInterval(upd, 1000);
    activePill.classList.add('show');
  } else activePill.classList.remove('show');
}

async function showAuth(setup) {
  started = false;
  document.body.classList.add('auth');
  authView(app, { setup, onDone: () => location.reload() });
}

async function startApp() {
  if (started) return;
  started = true;
  document.body.classList.remove('auth');
  mount(app, main, activePill, nav);
  loadActive();
  restoreTimer();
  window.addEventListener('hashchange', render);
  render();
}

async function boot() {
  setUnauthorizedHandler(() => {
    clearCache();
    showAuth(false);
  });
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  try {
    await loadCatalog();
  } catch {
    mount(app, h('p.center', 'Kan de app niet laden. Controleer je verbinding.'));
    return;
  }

  let state;
  try {
    state = await api('auth/state');
  } catch (e) {
    // Offline: continue with cached data if we have it.
    if (e.code === 'network' && loadCache()) {
      S.offline = true;
      startApp();
      toast('Offline: je werkt met de laatst bekende gegevens.');
      return;
    }
    mount(app, h('p.center', 'Server niet bereikbaar. Probeer het later opnieuw.'));
    return;
  }
  if (state.setup_needed) return showAuth(true);
  if (!state.user) return showAuth(false);

  loadCache();
  await flushOutbox().catch(() => {});
  await refresh().catch(() => {});
  startApp();
}

window.addEventListener('online', async () => {
  S.offline = false;
  const sent = await flushOutbox().catch(() => []);
  await refresh().catch(() => {});
  if (sent?.length) toast('Offline trainingen gesynchroniseerd ✔', 'ok');
});
window.addEventListener('offline', () => {
  S.offline = true;
  updateChrome();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
