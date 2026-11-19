// Account setup (first run) and login, including the TOTP step.
import { h, mount } from '../ui.js';
import { api, errorMessage } from '../api.js';

export function authView(root, { setup, onDone }) {
  let step = 'password';
  const err = h('p.error', { role: 'alert' });
  const username = h('input', { name: 'username', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: false });
  const password = h('input', { name: 'password', type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, minLength: setup ? 10 : 1 });
  const password2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const code = h('input', { name: 'code', inputMode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxLength: 7 });
  const codeField = h('label.field.hidden', h('span', 'Code uit je authenticator-app'), code);
  const submit = h('button.btn.block', { type: 'submit' }, setup ? 'Account aanmaken' : 'Inloggen');

  const form = h('form.auth-card', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (setup && password.value !== password2.value) {
        err.textContent = 'Wachtwoorden zijn niet gelijk.';
        return;
      }
      submit.disabled = true;
      try {
        if (setup) {
          await api('auth/setup', { body: { username: username.value.trim(), password: password.value } });
          onDone();
        } else {
          const res = await api('auth/login', { body: { username: username.value.trim(), password: password.value, code: step === 'totp' ? code.value : '' } });
          if (res.status === 'totp_required') {
            step = 'totp';
            codeField.classList.remove('hidden');
            username.disabled = password.disabled = true;
            code.focus();
          } else onDone();
        }
      } catch (ex) {
        err.textContent = errorMessage(ex);
        if (step === 'totp') code.select();
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('div.brand', h('div.logo', '💪'), h('h1', 'Fitness')),
  setup ? h('p.muted', 'Welkom! Maak je account aan. Daarna kan niemand anders zich meer registreren.') : null,
  h('label.field', h('span', 'Gebruikersnaam'), username),
  h('label.field', h('span', 'Wachtwoord'), password),
  setup ? h('label.field', h('span', 'Herhaal wachtwoord'), password2) : null,
  setup ? h('p.small.muted', 'Minimaal 10 tekens. Tip: een zin van een paar woorden is sterk én makkelijk te onthouden. Na het inloggen kun je tweestapsverificatie aanzetten.') : null,
  codeField,
  err,
  submit);
  mount(root, h('div.auth-wrap', form));
  username.focus();
}
