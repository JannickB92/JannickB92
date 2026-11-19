// Small DOM helpers. All content is inserted as text nodes / properties, never as HTML,
// so user data can't inject markup (XSS-safe by construction).

export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Minimal stroke icon set (24x24), drawn as paths.
const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  body: 'M12 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 8h14M12 8v6m0 0l-3 8m3-8l3 8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  swap: 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  info: 'M12 16v-5M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  timer: 'M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 9v4l2 2M9 2h6',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  back: 'M15 18l-6-6 6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  camera: 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  dumbbell: 'M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

export function icon(name, cls = '') {
  return s('svg', { viewBox: '0 0 24 24', class: 'icon ' + cls, 'aria-hidden': 'true' },
    s('path', { d: ICONS[name] || ICONS.info }));
}

export function iconBtn(name, label, onclick, cls = '') {
  return h('button.icon-btn', { type: 'button', title: label, 'aria-label': label, onclick, class: cls }, icon(name));
}

// ---------------------------------------------------------------- toast & sheets

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3200);
}

/** Bottom sheet / modal. Returns {el, close}. */
export function sheet(title, content, { onClose, wide } = {}) {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const body = h('div.sheet-body', content);
  const panel = h('div.sheet' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.sheet-head', h('h2', title), iconBtn('x', 'Sluiten', close)),
    body);
  const backdrop = h('div.backdrop', { onclick: (e) => e.target === backdrop && close() }, panel);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  return { el: body, close };
}

export function confirmDialog(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); sh.close(); } };
    const sh = sheet('Bevestigen', [
      h('p', message),
      h('div.row.end',
        h('button.btn.ghost', { onclick: () => finish(false) }, 'Annuleren'),
        h('button.btn' + (danger ? '.danger' : ''), { onclick: () => finish(true) }, okLabel)),
    ], { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

// ---------------------------------------------------------------- formatting

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), ss = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function fmtMinutes(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} u ${m % 60} min` : `${m} min`;
}

const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export function fmtDate(tsOrDate, withDay = true) {
  const d = typeof tsOrDate === 'number' ? new Date(tsOrDate * 1000) : new Date(tsOrDate + 'T12:00:00');
  return (withDay ? DAYS[d.getDay()] + ' ' : '') + d.getDate() + ' ' + MONTHS[d.getMonth()] +
    (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}

export function fmtKg(w) {
  if (w === null || w === undefined || w === '') return '';
  return String(Math.round(w * 100) / 100).replace('.', ',');
}

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseNum(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function uid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Segmented control / chip group. */
export function chips(options, value, onChange, { multi = false } = {}) {
  const wrap = h('div.chips');
  const render = () => {
    wrap.replaceChildren(...options.map(([val, label]) => {
      const on = multi ? value.includes(val) : value === val;
      return h('button.chip' + (on ? '.on' : ''), {
        type: 'button', 'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          if (multi) value = on ? value.filter((v) => v !== val) : [...value, val];
          else value = val;
          render();
          onChange(value);
        },
      }, label);
    }));
  };
  render();
  return wrap;
}

export function toggle(label, checked, onChange) {
  return h('label.toggle',
    h('span', label),
    h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
    h('span.track'));
}

export function stepper(value, { min = 0, max = 999, step = 1, onChange, fmt = (v) => v }) {
  const val = h('span.stepper-val', fmt(value));
  const set = (v) => { value = Math.min(max, Math.max(min, Math.round(v * 100) / 100)); val.textContent = fmt(value); onChange(value); };
  return h('div.stepper',
    h('button', { type: 'button', 'aria-label': 'Minder', onclick: () => set(value - step) }, '−'),
    val,
    h('button', { type: 'button', 'aria-label': 'Meer', onclick: () => set(value + step) }, '+'));
}

export function empty(text, action) {
  return h('div.empty', h('p', text), action || null);
}

/** Replace an element's children; skips null/false and flattens arrays (unlike replaceChildren). */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
