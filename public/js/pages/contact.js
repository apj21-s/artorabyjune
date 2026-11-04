import { $, formData } from '../core/dom.js';
import { post } from '../core/api.js';
import { initLayout, bootstrap } from '../core/layout.js';
import { validateForm, handleFormError, busy } from '../core/ui.js';

initLayout();

const form = $('[data-contact]');
const params = new URLSearchParams(location.search);
if (params.get('topic')) form.topic.value = params.get('topic');

bootstrap().then(({ site }) => {
  if (site.replyTime) $('[data-reply-time]').textContent = site.replyTime;
  if (site.supportEmail) {
    const a = $('[data-contact-email]');
    a.href = `mailto:${site.supportEmail}`;
    a.textContent = site.supportEmail;
  }
  if (site.whatsapp) {
    const p = $('[data-contact-wa]');
    p.hidden = false;
    p.querySelector('a').href = `https://wa.me/${site.whatsapp.replace(/\D/g, '')}`;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(form)) return;
  await busy(form.querySelector('button[type="submit"]'), async () => {
    try {
      await post('/contact', formData(form));
      form.innerHTML = '<div class="empty-state"><img src="/assets/june-character.svg" alt=""><h3>Your note is with June.</h3><p>She’ll write back to you by email soon.</p></div>';
    } catch (error) { handleFormError(form, error); }
  });
});
