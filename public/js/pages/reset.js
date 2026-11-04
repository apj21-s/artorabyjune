import { $ } from '../core/dom.js';
import { post } from '../core/api.js';
import { initLayout } from '../core/layout.js';
import { validateForm, handleFormError, busy } from '../core/ui.js';

initLayout();

const form = $('[data-reset]');
const params = new URLSearchParams(location.search);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(form)) return;
  await busy(form.querySelector('button'), async () => {
    try {
      await post('/auth/reset', { email: params.get('email') || '', token: params.get('token') || '', password: form.password.value });
      location.href = '/account';
    } catch (error) { handleFormError(form, error); }
  });
});
