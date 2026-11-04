import { $, html, raw, fmtDate } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout } from '../core/layout.js';
import { validateForm, handleFormError, busy } from '../core/ui.js';
import { timeline, paymentChip } from '../core/components.js';

initLayout();

const form = $('[data-track]');
const out = $('[data-track-result]');
const params = new URLSearchParams(location.search);
if (params.get('number')) form.number.value = params.get('number');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(form)) return;
  await busy(form.querySelector('button'), async () => {
    try {
      const q = new URLSearchParams({ number: form.number.value.trim().toUpperCase(), email: form.email.value.trim() });
      const { order: o } = await get(`/orders/track?${q}`);
      // The result is a kraft shipping label with the status stamped on it.
      out.innerHTML = html`
        <section class="ship-label">
          <div class="ship-label-head"><span>Artora by June · parcel</span><span class="ship-barcode" aria-hidden="true"></span></div>
          <div class="ship-label-body">
            <div>
              <p class="ship-k">Order no.</p><p class="ship-no">${o.number}</p>
              <p class="ship-k">Placed</p><p class="ship-v">${fmtDate(o.createdAt)}</p>
              ${o.tracking?.number ? raw(html`<p class="ship-k">Courier</p><p class="ship-v">${o.tracking.courier || 'Courier'} · ${o.tracking.number}</p>`) : ''}
              <div class="meta-row">${raw(paymentChip(o))}</div>
            </div>
            <p class="ship-stamp"><span>${o.statusLabel}</span></p>
          </div>
          ${raw(timeline(o.timeline))}
          ${o.tracking?.url ? raw(html`<a class="btn btn-primary btn-sm" href="${o.tracking.url}" target="_blank" rel="noopener">Track the parcel ↗</a>`) : ''}
          <p class="helper-note">Need to approve a sketch or pay? Use the link in your email, or <a href="/login">sign in</a> with this email.</p>
        </section>`;
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      out.innerHTML = '';
      handleFormError(form, error);
    }
  });
});
