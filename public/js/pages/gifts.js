import { $, html, raw, fmtDate } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout, bootstrap } from '../core/layout.js';
import { reveal } from '../core/ui.js';

initLayout();

function maxDays(range, fallback) {
  return Number(String(range || '').split(/[–-]/).pop()) || fallback;
}

(async () => {
  const [{ site, tiers, gifting }, { items }] = await Promise.all([bootstrap(), get('/products?inStock=1&limit=24')]);

  const input = $('#giftDate');
  input.min = new Date().toISOString().slice(0, 10);
  const result = $('[data-planner-result]');
  const plan = () => {
    if (!input.value) { result.innerHTML = ''; return; }
    const target = new Date(`${input.value}T12:00:00`);
    const days = Math.ceil((target - new Date()) / 86400000);
    const shopNeed = maxDays(site.dispatchDays, 3) + maxDays(site.deliveryDays, 7);
    const lines = [];
    const shopBy = new Date(target.getTime() - shopNeed * 86400000);
    lines.push(days >= shopNeed
      ? html`<p class="ok">✓ <strong>Ready-made tote:</strong> order by ${fmtDate(shopBy, { weekday: 'short', day: 'numeric', month: 'short' })}.</p>`
      : html`<p class="warn">✕ <strong>Ready-made tote:</strong> very tight — message June to check.</p>`);
    tiers.forEach((t) => {
      const need = 2 + (Number(t.days) || 7) + maxDays(site.deliveryDays, 7);
      const by = new Date(target.getTime() - need * 86400000);
      lines.push(days >= need
        ? html`<p class="ok">✓ <strong>${t.title} commission:</strong> write to June by ${fmtDate(by, { weekday: 'short', day: 'numeric', month: 'short' })}.</p>`
        : html`<p class="warn">✕ <strong>${t.title} commission:</strong> not enough time for this size.</p>`);
    });
    result.innerHTML = lines.join('');
  };
  input.addEventListener('input', plan);

  // One compact card per occasion: shop the matching totes, or commission one.
  $('[data-occasion-sections]').innerHTML = html`<div class="occasion-row gift-occasions">${gifting.map((g) => {
    const count = items.filter((p) => (p.tags || []).includes(g.key)).length;
    return raw(html`
      <div class="occasion occ-${g.colour || 'ochre'} reveal" id="${g.key}">
        <h3>${g.title}</h3>
        <p>${g.blurb}</p>
        <div class="occasion-links">
          ${count ? raw(html`<a href="/shop?tag=${encodeURIComponent(g.key)}">Shop ${count} ${count === 1 ? 'tote' : 'totes'} →</a>`) : ''}
          <a href="/commission?occasion=${encodeURIComponent(g.title)}">Commission →</a>
        </div>
      </div>`);
  })}</div>`;
  reveal();
  if (location.hash) $(location.hash)?.scrollIntoView();
})();
