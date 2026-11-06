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
    $('[data-contact-email-row]').hidden = false;
  }
  if (site.whatsapp) {
    const p = $('[data-contact-wa]');
    p.hidden = false;
    p.querySelector('a').href = `https://wa.me/${site.whatsapp.replace(/\D/g, '')}`;
  }
});

// One id per note: if the request is retried or tapped twice, the studio still gets it once.
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
let clientId = newId();
const startedAt = Date.now();
let sending = false;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sending || !validateForm(form)) return;
  sending = true;
  await busy(form.querySelector('button[type="submit"]'), async () => {
    try {
      const data = formData(form);
      const res = await post('/contact', { ...data, clientId, startedAt });
      const copy = res.ack
        ? `A copy is on its way to <strong>${escapeHtml(data.email)}</strong>. June will reply from the studio inbox.`
        : 'She’ll write back to you by email soon.';
      form.innerHTML = `<div class="empty-state" role="status" tabindex="-1"><img src="/assets/june-character.svg" alt=""><h3>Your note is with June.</h3><p>${copy}</p></div>`;
      form.querySelector('[role="status"]').focus({ preventScroll: true });
    } catch (error) {
      if (error.status === 0) error.message = 'You seem to be offline. Your note is still here; try again when you’re connected.';
      handleFormError(form, error);
    } finally {
      sending = false;
    }
  }, 'Sending…');
});

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
