import { $, $$ } from '../core/dom.js';
import { post } from '../core/api.js';
import { initLayout, bootstrap } from '../core/layout.js';
import { validateForm, handleFormError, busy, toast } from '../core/ui.js';

initLayout();

const form = $('[data-auth-form]');
const params = new URLSearchParams(location.search);
const next = (() => {
  const n = params.get('next') || '/account';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/account';
})();
let mode = params.get('mode') === 'signup' ? 'signup' : 'login';

const COPY = {
  login: { title: 'Welcome back.', submit: 'Sign in', auto: 'current-password' },
  signup: { title: 'Make yourself a studio.', submit: 'Create account', auto: 'new-password' },
  forgot: { title: 'Reset your password.', submit: 'Email me a link', auto: 'off' },
};

function setMode(m) {
  mode = m;
  $$('[data-auth-tab]').forEach((t) => {
    if (!t.classList.contains('tab')) return;
    const on = t.dataset.authTab === m;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('[data-auth-tab="forgot"].tab').hidden = m !== 'forgot';
  $$('[data-only="signup"]').forEach((el) => { el.hidden = m !== 'signup'; });
  $$('[data-hide="forgot"]').forEach((el) => { el.hidden = m === 'forgot'; });
  form.name.required = m === 'signup';
  form.password.required = m !== 'forgot';
  form.password.autocomplete = COPY[m].auto;
  $('[data-auth-title]').textContent = COPY[m].title;
  $('[data-auth-submit]').textContent = COPY[m].submit;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-auth-tab]');
  if (t) setMode(t.dataset.authTab);
});

$('[data-show-pass]').addEventListener('click', (e) => {
  const show = form.password.type === 'password';
  form.password.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? 'Hide' : 'Show';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(form)) return;
  await busy($('[data-auth-submit]'), async () => {
    try {
      const email = form.email.value.trim();
      if (mode === 'forgot') {
        await post('/auth/forgot', { email });
        // A clear message that stays on the page (a toast vanishes too fast to notice).
        $('[data-auth-note]')?.remove();
        const note = document.createElement('p');
        note.className = 'auth-note';
        note.dataset.authNote = '';
        note.setAttribute('role', 'status');
        note.textContent = `If ${email} has an account, a reset link is on its way. Check your inbox and spam folder; the link works for 1 hour. Nothing after a few minutes? Make sure it’s the email you signed up with.`;
        form.before(note);
        setMode('login');
        return;
      }
      const body = mode === 'signup'
        ? { name: form.name.value.trim(), email, password: form.password.value }
        : { email, password: form.password.value };
      const { user } = await post(mode === 'signup' ? '/auth/register' : '/auth/login', body);
      location.href = user.role === 'admin' && next === '/account' ? '/admin' : next;
    } catch (error) { handleFormError(form, error); }
  });
});

const errors = { 'google-failed': 'Google sign-in didn’t work. Try again or use email.', 'google-unavailable': 'Google sign-in isn’t set up yet. Use email for now.' };
if (errors[params.get('error')]) toast(errors[params.get('error')], { type: 'error' });

bootstrap().then(({ features }) => {
  if (!features?.google) return;
  $('[data-google]').href = `/api/auth/google/start?returnTo=${encodeURIComponent(next)}`;
  $('[data-google]').hidden = false;
  $('[data-google-wrap]').hidden = false;
});

setMode(mode);
