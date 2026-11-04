import { $, html } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout, wireAddToCart } from '../core/layout.js';
import { reveal, showSheet, hideSheet } from '../core/ui.js';
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
let allTags = [];

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
    allTags = tags;
    renderChips(tags);
    renderPhoneBar(items.length);
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

// ---------- Phones: one "Filter & sort" button, a bottom sheet with a live count, removable pills ----------
const label = (t) => (t ? t[0].toUpperCase() + t.slice(1) : 'All');
const SORTS = { featured: 'Featured', new: 'Newest', 'price-asc': 'Price ↑', 'price-desc': 'Price ↓' };
const draft = { ...state };
// The sheet lives at the top level so it layers above the backdrop and the tab bar.
document.body.appendChild($('#filterSheet'));

function renderPhoneBar(count) {
  $('[data-result-count]').textContent = `${count} ${count === 1 ? 'tote' : 'totes'}`;
  const active = [state.tag && ['tag', label(state.tag)], state.inStock && ['inStock', 'In stock'], state.sort !== 'featured' && ['sort', SORTS[state.sort]]].filter(Boolean);
  const badge = $('[data-filter-badge]');
  badge.hidden = !active.length;
  badge.textContent = String(active.length);
  $('[data-filter-pills]').innerHTML = active.map(([k, v]) => html`<button class="filter-pill" type="button" data-pill="${k}" aria-label="Remove ${v}">${v}<span aria-hidden="true">×</span></button>`).join('');
}

function paintSheet() {
  $('[data-sheet-tags]').innerHTML = [''].concat(allTags).map((t) => html`<button type="button" role="radio" class="filter-opt" data-sheet-tag="${t}" aria-checked="${String(draft.tag === t)}">${label(t)}</button>`).join('');
  $('[data-sheet-stock]').checked = draft.inStock;
  document.querySelectorAll('[name="sheetSort"]').forEach((r) => { r.checked = r.value === draft.sort; });
}

// Count what the current choices would show, so the button can say "Show 4 totes" before applying.
let countCtrl;
async function previewCount() {
  countCtrl?.abort();
  countCtrl = new AbortController();
  const q = new URLSearchParams({ sort: draft.sort });
  if (draft.tag) q.set('tag', draft.tag);
  if (draft.inStock) q.set('inStock', '1');
  const btn = $('[data-sheet-apply]');
  try {
    const { items } = await get(`/products?${q}`, { signal: countCtrl.signal });
    btn.textContent = items.length ? `Show ${items.length} ${items.length === 1 ? 'tote' : 'totes'}` : 'No totes match';
    btn.disabled = !items.length;
  } catch { /* keep the last label */ }
}

$('[data-filter-open]').addEventListener('click', () => {
  Object.assign(draft, state);
  paintSheet();
  previewCount();
  showSheet($('#filterSheet'));
});
$('[data-sheet-tags]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sheet-tag]');
  if (!b) return;
  draft.tag = b.dataset.sheetTag;
  paintSheet();
  previewCount();
});
$('[data-sheet-stock]').addEventListener('change', (e) => { draft.inStock = e.target.checked; previewCount(); });
$('[data-sheet-sort]').addEventListener('change', (e) => { draft.sort = e.target.value; });
$('[data-sheet-clear]').addEventListener('click', () => { Object.assign(draft, { tag: '', inStock: false, sort: 'featured' }); paintSheet(); previewCount(); });
$('[data-sheet-apply]').addEventListener('click', () => {
  Object.assign(state, draft);
  sort.value = state.sort;
  stock.checked = state.inStock;
  syncUrl();
  load();
  hideSheet($('#filterSheet'));
  $('[data-shop-toolbar]').closest('main')?.querySelector('.board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('[data-filter-pills]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pill]');
  if (!b) return;
  if (b.dataset.pill === 'tag') state.tag = '';
  if (b.dataset.pill === 'inStock') { state.inStock = false; stock.checked = false; }
  if (b.dataset.pill === 'sort') { state.sort = 'featured'; sort.value = 'featured'; }
  syncUrl();
  load();
});

load();
