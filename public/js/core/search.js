// Header search: a canvas sheet that drops from the top, with instant results for totes and stories.
import { $, html, raw, inr, debounce } from './dom.js';
import { get } from './api.js';
import { showSheet } from './ui.js';

export function wireSearch() {
  const sheet = $('#searchSheet');
  const input = $('#searchInput');
  const out = $('[data-search-results]');
  if (!sheet || !input) return;
  let last = '';

  const render = (q, products, stories) => {
    if (!products.length && !stories.length) {
      out.innerHTML = html`<p class="search-empty">Nothing painted with “${q}” yet. <a href="/commission?memory=${encodeURIComponent(q)}">Ask June to paint it →</a></p>`;
      return;
    }
    out.innerHTML = html`
      ${products.length ? raw(html`<p class="search-label">Totes</p><div class="search-totes">${products.map((p) => raw(html`
        <a class="search-tote" href="/shop/${p.slug}"><img src="${p.images[0] || '/assets/totes/sunday-sun.svg'}" alt="" loading="lazy"><span>${p.title}</span><small>${inr(p.price)}${p.inStock ? '' : ' · sold out'}</small></a>`))}</div>`) : ''}
      ${stories.length ? raw(html`<p class="search-label">Stories</p><ul class="search-stories">${stories.slice(0, 5).map((s) => raw(html`<li><a href="/stories/${s.slug}">${s.title}<small>${s.category || ''}</small></a></li>`))}</ul>`) : ''}`;
  };

  const run = debounce(async () => {
    const q = input.value.trim();
    if (q === last) return;
    last = q;
    if (q.length < 2) { out.innerHTML = '<p class="search-hint">Try “dog”, “sunset”, “birthday” or “city”.</p>'; return; }
    try {
      const [p, s] = await Promise.all([get(`/products?q=${encodeURIComponent(q)}&limit=6`), get(`/portfolio?q=${encodeURIComponent(q)}`)]);
      if (input.value.trim() === q) render(q, p.items, s.items);
    } catch { out.innerHTML = '<p class="search-hint">Search is resting. Try again in a moment.</p>'; }
  }, 180);

  input.addEventListener('input', run);
  const open = () => { showSheet(sheet); setTimeout(() => input.focus(), 60); };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-search-open]')) open(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); open(); }
  });
}
