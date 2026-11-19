// API client with an offline outbox for workouts (training in a basement gym must never lose data).

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  invalid_credentials: 'Gebruikersnaam of wachtwoord klopt niet.',
  invalid_code: 'De code klopt niet. Probeer de volgende code.',
  too_many_attempts: 'Te veel pogingen. Wacht 15 minuten.',
  weak_password: 'Wachtwoord moet minstens 10 tekens hebben.',
  invalid_username: 'Gebruikersnaam: 3–40 tekens (letters, cijfers, . _ -).',
  wrong_password: 'Huidig wachtwoord klopt niet.',
  not_logged_in: 'Je bent uitgelogd.',
  setup_done: 'Er bestaat al een account.',
  too_large: 'Bestand is te groot.',
  not_an_image: 'Dit is geen geldige afbeelding.',
  network: 'Geen verbinding met de server.',
  server_error: 'Er ging iets mis op de server.',
};

export function errorMessage(e) {
  return MESSAGES[e?.code] || (e?.code ? `Fout: ${e.code}` : 'Onbekende fout');
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(route, { body, form, method } = {}) {
  const opts = {
    method: method || (body || form ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'X-Fit': '1' },
  };
  if (form) opts.body = form;
  else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('api/?r=' + encodeURIComponent(route), opts);
  } catch {
    throw new ApiError('network', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(res.status >= 500 ? 'server_error' : 'network', res.status);
  }
  if (!res.ok) {
    const err = new ApiError(data?.error || 'server_error', res.status);
    if (res.status === 401 && err.code === 'not_logged_in') onUnauthorized();
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- outbox

const OUTBOX_KEY = 'fit.outbox';

function readOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; }
}
function writeOutbox(list) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
}

export function outboxCount() {
  return readOutbox().length;
}

export function pendingWorkouts() {
  return readOutbox().filter((e) => e.route === 'workouts/save').map((e) => e.body.workout);
}

/** Queue a request; it's sent now if possible, otherwise on the next flush. */
export async function queue(route, body) {
  const list = readOutbox().filter((e) => !(e.route === route && e.key && e.key === body?.workout?.uid));
  list.push({ id: Date.now() + '-' + Math.random(), route, body, key: body?.workout?.uid || null });
  writeOutbox(list);
  return flushOutbox();
}

let flushing = null;
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    const results = [];
    let list = readOutbox();
    while (list.length) {
      const item = list[0];
      try {
        results.push(await api(item.route, { body: item.body }));
      } catch (e) {
        // Network problems: keep it for later. Validation errors: drop to avoid blocking the queue forever.
        if (e.code === 'network' || e.status >= 500 || e.status === 401) break;
        console.warn('Dropping outbox item', item, e);
      }
      list = readOutbox().filter((e) => e.id !== item.id);
      writeOutbox(list);
    }
    return results;
  })().finally(() => (flushing = null));
  return flushing;
}
