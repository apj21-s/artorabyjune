// Recently viewed totes, kept in this browser only.
import { read, write } from './store.js';
import { html, inr } from './dom.js';

const KEY = 'artora.recent.v1';

export function pushRecent(p) {
  if (!p || p.kind === 'giftcard') return;
  const entry = { id: p.id, slug: p.slug, title: p.title, price: p.price, image: p.images?.[0] || '' };
  const list = (read(KEY, []) || []).filter((i) => i.id !== p.id);
  write(KEY, [entry, ...list].slice(0, 8));
}

export const getRecent = (excludeId) => (read(KEY, []) || []).filter((i) => i.id !== excludeId);

// A row of little polaroids.
export function recentRow(items) {
  return items.map((i, n) => html`
    <a class="recent-item" href="/shop/${i.slug}" style="--r:${[-2, 1.5, -1, 2][n % 4]}deg">
      <img src="${i.image || '/assets/totes/sunday-sun.svg'}" alt="" loading="lazy" width="160" height="200">
      <span>${i.title}</span><small>${inr(i.price)}</small>
    </a>`).join('');
}
