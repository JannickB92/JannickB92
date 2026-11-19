// "Meer": training preferences, security (password, 2FA, sessions), data export.
import { h, icon, toggle, chips, sheet, toast, stepper, fmtKg, mount } from '../ui.js';
import { S, EQUIPMENT, saveSettings, clearCache } from '../store.js';
import { api, errorMessage, outboxCount, flushOutbox } from '../api.js';
import { refresh, go, APP_VERSION } from '../app.js';
import { unlockAudio } from '../timer.js';

export function settingsView(root) {
  const st = () => S.settings;
  const save = (patch) => saveSettings(patch).catch((e) => toast(errorMessage(e), 'error'));
  const pending = outboxCount();

  mount(root, 
    h('header.page-head', h('h1', 'Meer')),
    h('nav.card.menu-card',
      h('a.list-row', { href: '#/library' }, h('span', icon('dumbbell'), ' Oefeningen & eigen oefeningen'), icon('back', 'flip')),
      h('a.list-row', { href: '#/train' }, h('span', icon('list'), ' Mijn trainingen'), icon('back', 'flip'))),
    pending ? h('section.card.warn-card',
      h('p', `${pending} training(en) wachten op synchronisatie.`),
      h('button.btn.small', { type: 'button', onclick: async () => { await flushOutbox(); await refresh().catch(() => {}); go('#/settings', true); } }, 'Nu synchroniseren')) : null,

    h('section.card',
      h('h2', 'Training'),
      toggle('Rusttimer automatisch starten na een set', st().autoRest, (v) => save({ autoRest: v })),
      toggle('Geluid', st().sound, (v) => { unlockAudio(); save({ sound: v }); }),
      toggle('Trillen', st().vibrate, (v) => save({ vibrate: v })),
      toggle('Warming-up toevoegen', st().warmup, (v) => save({ warmup: v })),
      toggle('Cooling-down (stretchen) toevoegen', st().cooldown, (v) => save({ cooldown: v })),
      h('div.field-row', h('span', 'Gewicht halterstang'), stepper(st().barWeight, { min: 0, max: 30, step: 2.5, fmt: (v) => fmtKg(v) + ' kg', onChange: (v) => save({ barWeight: v }) })),
      h('div.field', h('span.label', 'Beschikbaar materiaal'), chips(Object.entries(EQUIPMENT).filter(([k]) => k !== 'bodyweight'), st().equipment, (v) => save({ equipment: v }), { multi: true })),
      'Notification' in window ? h('div.field-row',
        h('span', 'Melding als de rust voorbij is (scherm uit)'),
        Notification.permission === 'granted' ? h('span.pill', 'Aan')
          : h('button.btn.small.ghost', { type: 'button', onclick: async () => { await Notification.requestPermission(); go('#/settings', true); } }, 'Toestaan')) : null,
      h('p.small.muted', 'Tijdens een training blijft het scherm aan. Meldingen met scherm uit werken niet op elk toestel.')),

    h('section.card',
      h('h2', 'Beveiliging'),
      h('p', 'Ingelogd als ', h('strong', S.user?.username || '')),
      h('div.field-row', h('span', 'Tweestapsverificatie'),
        S.user?.totp ? h('button.btn.small.ghost', { type: 'button', onclick: disableTotp }, 'Aan · uitzetten') : h('button.btn.small', { type: 'button', onclick: enableTotp }, 'Aanzetten')),
      h('button.btn.ghost.block', { type: 'button', onclick: changePassword }, 'Wachtwoord wijzigen'),
      h('button.btn.ghost.block', {
        type: 'button',
        onclick: async () => {
          try {
            const r = await api('auth/revoke-others', { body: {} });
            toast(`${r.revoked} andere sessie(s) uitgelogd`, 'ok');
          } catch (e) { toast(errorMessage(e), 'error'); }
        },
      }, 'Uitloggen op alle andere apparaten'),
      h('button.btn.ghost.block.danger-text', {
        type: 'button',
        onclick: async () => {
          await api('auth/logout', { body: {} }).catch(() => {});
          clearCache();
          location.hash = '#/';
          location.reload();
        },
      }, 'Uitloggen')),

    h('section.card',
      h('h2', 'Je gegevens'),
      h('p.small.muted', 'Alles staat in één SQLite-bestand op je eigen hosting. Exporteer regelmatig als extra back-up.'),
      h('div.row.gap',
        h('a.btn.ghost.grow', { href: 'api/?r=export/json', download: '' }, 'Export JSON'),
        h('a.btn.ghost.grow', { href: 'api/?r=export/csv', download: '' }, 'Export CSV (sets)'))),
    h('p.small.muted.center', `Fitness ${APP_VERSION}`),
  );
}

function changePassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password', minLength: 10 });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const sh = sheet('Wachtwoord wijzigen', [
    h('label.field', h('span', 'Huidig wachtwoord'), cur),
    h('label.field', h('span', 'Nieuw wachtwoord (min. 10 tekens)'), n1),
    h('label.field', h('span', 'Herhaal nieuw wachtwoord'), n2),
    h('button.btn.block', {
      type: 'button',
      onclick: async () => {
        if (n1.value !== n2.value) return toast('Nieuwe wachtwoorden zijn niet gelijk.');
        try {
          await api('auth/password', { body: { current: cur.value, new: n1.value } });
          toast('Wachtwoord gewijzigd. Andere apparaten zijn uitgelogd.', 'ok');
          sh.close();
        } catch (e) { toast(errorMessage(e), 'error'); }
      },
    }, 'Opslaan'),
  ]);
}

function enableTotp() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const step2 = h('div');
  const sh = sheet('Tweestapsverificatie aanzetten', [
    h('p', 'Je hebt een authenticator-app nodig, zoals Google Authenticator, Microsoft Authenticator of Aegis.'),
    h('label.field', h('span', 'Bevestig met je wachtwoord'), pw),
    h('button.btn.block', {
      type: 'button',
      onclick: async (e) => {
        try {
          const r = await api('auth/totp-begin', { body: { password: pw.value } });
          e.target.remove();
          const code = h('input.big-input', { inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7, placeholder: '123456' });
          const secretText = r.secret.match(/.{1,4}/g).join(' ');
          mount(step2, 
            h('ol.tips',
              h('li', 'Open je authenticator-app en kies "Code toevoegen" → "Insteltoets invoeren".'),
              h('li', 'Accountnaam: Fitness. Sleutel:'),
            ),
            h('div.secret', secretText),
            h('div.row.gap',
              h('button.btn.small.ghost', { type: 'button', onclick: () => navigator.clipboard?.writeText(r.secret).then(() => toast('Gekopieerd')) }, 'Kopieer sleutel'),
              h('a.btn.small.ghost', { href: r.uri }, 'Open in app (op telefoon)')),
            h('label.field', h('span', 'Vul de 6-cijferige code in ter controle'), code),
            h('button.btn.block', {
              type: 'button',
              onclick: async () => {
                try {
                  await api('auth/totp-enable', { body: { code: code.value } });
                  await refresh();
                  toast('Tweestapsverificatie staat aan 🔒', 'ok');
                  sh.close();
                  go('#/settings', true);
                } catch (err) { toast(errorMessage(err), 'error'); }
              },
            }, 'Activeren'));
        } catch (err) { toast(errorMessage(err), 'error'); }
      },
    }, 'Volgende'),
    step2,
  ]);
}

function disableTotp() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const code = h('input', { inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7 });
  const sh = sheet('Tweestapsverificatie uitzetten', [
    h('p.warn', 'Je account is daarna alleen nog met je wachtwoord beveiligd.'),
    h('label.field', h('span', 'Wachtwoord'), pw),
    h('label.field', h('span', 'Huidige code'), code),
    h('button.btn.block.danger', {
      type: 'button',
      onclick: async () => {
        try {
          await api('auth/totp-disable', { body: { password: pw.value, code: code.value } });
          await refresh();
          sh.close();
          go('#/settings', true);
        } catch (e) { toast(errorMessage(e), 'error'); }
      },
    }, 'Uitzetten'),
  ]);
}
