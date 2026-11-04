import { html, raw, inr, fmtDate } from './dom.js';
import { isSaved } from './saved.js';

export const HEART = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
export const saveButton = (p, extra = '') => html`<button class="save-btn ${extra}" type="button" data-save="${p.id}" aria-pressed="${String(isSaved(p.id))}" aria-label="Save ${p.title}">${raw(HEART)}</button>`;

const TAPE_BY_BADGE = { new: 'tape-blue', limited: 'tape-cherry', 'one of one': 'tape-ochre', bestseller: 'tape-sage' };

export function productCard(p, i = 0) {
  const soldOut = !p.inStock;
  const badge = soldOut ? 'Sold out' : (p.badge || (p.lowStock ? 'Last one' : ''));
  const tapeClass = soldOut ? 'tape-ink' : (TAPE_BY_BADGE[String(p.badge).toLowerCase()] || 'tape-ochre');
  return html`
    <article class="card product-card reveal${soldOut ? ' is-soldout' : ''}" style="--i:${i % 8};">
      <div class="pin" style="background:${['#C1443C', '#3A4CA6', '#C98A2A', '#6C7C5C'][i % 4]};"></div>
      <a class="card-link" href="/shop/${p.slug}">
        <div class="product-media">
          ${badge ? raw(html`<span class="tape ${tapeClass}">${badge}</span>`) : ''}
          ${p.kind === 'giftcard' ? '' : raw(saveButton(p))}
          <img src="${p.images[0] || '/assets/totes/sunday-sun.svg'}" alt="" loading="lazy" width="320" height="400">
          ${p.images[1] ? raw(html`<img src="${p.images[1]}" alt="" loading="lazy" aria-hidden="true" width="320" height="400">`) : ''}
        </div>
        <h3>${p.title}</h3>
        <p class="summary">${p.summary}</p>
      </a>
      <div class="product-meta">
        <span class="price-stamp">${inr(p.price)}${p.compareAt && p.compareAt > p.price ? raw(html`<s>${inr(p.compareAt)}</s>`) : ''}</span>
        <button class="quick-add" type="button" data-add-to-cart="${p.id}" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Sold out' : 'Add to bag'}</button>
      </div>
    </article>`;
}

export function stars(n = 5) {
  const full = Math.round(Number(n) || 0);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

export function reviewCard(r, i = 0) {
  return html`
    <figure class="review reveal" style="--i:${i};">
      ${r.photo ? raw(html`<img class="review-photo" src="${r.photo}" alt="Photo from ${r.name}" loading="lazy">`) : ''}
      <div class="stars" aria-label="${r.rating} out of 5">${stars(r.rating)}</div>
      <blockquote class="quote">“${r.text}”</blockquote>
      <figcaption class="who">— ${r.name}${r.city ? `, ${r.city}` : ''}</figcaption>
    </figure>`;
}

export function timeline(steps = []) {
  return html`<ol class="thread">${steps.map((s, i) => raw(html`
    <li class="is-${s.state}">
      <span class="pinpoint" aria-hidden="true">${s.state === 'done' ? '✓' : i + 1}</span>
      <div>
        <strong>${s.label}</strong>
        ${s.at ? raw(html`<time datetime="${new Date(s.at).toISOString()}">${fmtDate(s.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</time>`) : ''}
        ${s.state !== 'upcoming' && s.note ? raw(html`<p>${s.note}</p>`) : ''}
        <span class="sr-only">${s.state === 'done' ? 'completed' : s.state === 'current' ? 'current step' : 'upcoming'}</span>
      </div>
    </li>`))}</ol>`;
}

export function paymentChip(order) {
  const map = {
    paid: ['Paid', 'is-paid'],
    deposit_paid: ['Deposit paid', 'is-due'],
    unpaid: [order.type === 'commission' && order.status === 'received' ? 'Awaiting quote' : 'Payment due', 'is-due'],
    refunded: ['Refunded', 'is-cancel'],
  };
  const [label, cls] = map[order.paymentStatus] || [order.paymentStatus, ''];
  return html`<span class="status-chip ${cls}">${label}</span>`;
}

export function emptyState({ title, body, cta, href, image = '/assets/june-character.svg' }) {
  return html`<div class="empty-state">
    <img src="${image}" alt="" aria-hidden="true">
    <h3>${title}</h3>
    ${body ? raw(html`<p>${body}</p>`) : ''}
    ${cta ? raw(html`<a class="btn btn-primary" href="${href}">${cta}</a>`) : ''}
  </div>`;
}

export const SWATCH_BG = {
  movie: 'linear-gradient(135deg,#3A4CA6,#8892c9)',
  couple: 'linear-gradient(135deg,#f2c9c5,#C1443C)',
  pet: 'linear-gradient(135deg,#f1e0b8,#C98A2A)',
  nature: 'linear-gradient(135deg,#c9d4bd,#6C7C5C)',
  fandom: 'linear-gradient(135deg,#221D19,#4a4038)',
  words: 'linear-gradient(135deg,#f6ddc9,#C98A2A)',
  skyline: 'linear-gradient(135deg,#dfe3f0,#3A4CA6)',
  custom: 'linear-gradient(135deg,#f0e6e5,#C1443C)',
};

export function storyImage(item) {
  return item.image || `/assets/art/${item.art || 'custom'}.svg`;
}
