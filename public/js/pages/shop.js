import { $, html } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout, wireAddToCart } from '../core/layout.js';
import { reveal } from '../core/ui.js';
import { productCard, emptyState } from '../core/components.js';
import { getRecent, recentRow } from '../core/recent.js';

initLayout();

const recent = getRecent();
if (recent.length) {
  $('[data-recent]').innerHTML = recentRow(recent.slice(0, 6));
  $('[data-recent-wrap]').hidden = false;
}

const products = new Map();
wireAddToCart((id) => products.get(id));

const params = new URLSearchParams(location.search);
const state = {
  tag: params.get('tag') || '',
  sort: params.get('sort') || 'featured',
  inStock: params.get('inStock') === '1',
};

const grid = $('[data-products]');
const chips = $('[data-tag-chips]');
let controller;

function syncUrl() {
  const q = new URLSearchParams();
  if (state.tag) q.set('tag', state.tag);
  if (state.sort !== 'featured') q.set('sort', state.sort);
  if (state.inStock) q.set('inStock', '1');
  history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
}

function renderChips(tags) {
  chips.innerHTML = [''].concat(tags).map((t) => html`
    <button class="chip${state.tag === t ? ' is-active' : ''}" type="button" data-tag="${t}" aria-pressed="${state.tag === t}">${t ? t[0].toUpperCase() + t.slice(1) : 'All'}</button>`).join('');
}

async function load() {
  controller?.abort();
  controller = new AbortController();
  const q = new URLSearchParams({ sort: state.sort });
  if (state.tag) q.set('tag', state.tag);
  if (state.inStock) q.set('inStock', '1');
  grid.setAttribute('aria-busy', 'true');
  try {
    const { items, tags } = await get(`/products?${q}`, { signal: controller.signal });
    renderChips(tags);
    items.forEach((p) => products.set(p.id, p));
    grid.innerHTML = items.length
      ? items.map(productCard).join('')
      : `<div style="grid-column:1/-1">${emptyState({ title: 'Nothing here right now.', body: 'This drop has found its people. Try another filter, or commission your own.', cta: 'Commission a tote', href: '/commission' })}</div>`;
    reveal(grid);
  } catch (error) {
    if (error.name === 'AbortError') return;
    grid.innerHTML = `<div style="grid-column:1/-1">${emptyState({ title: 'The shop is taking a breather.', body: error.message })}</div>`;
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

chips.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  state.tag = chip.dataset.tag;
  syncUrl();
  load();
});

const sort = $('[data-sort]');
sort.value = state.sort;
sort.addEventListener('change', () => { state.sort = sort.value; syncUrl(); load(); });

const stock = $('[data-instock]');
stock.checked = state.inStock;
stock.addEventListener('change', () => { state.inStock = stock.checked; syncUrl(); load(); });

load();
