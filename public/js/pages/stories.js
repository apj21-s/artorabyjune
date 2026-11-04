import { $, html } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout } from '../core/layout.js';
import { reveal } from '../core/ui.js';
import { storyImage } from '../core/components.js';

initLayout();

const PIN = ['#C1443C', '#3A4CA6', '#C98A2A', '#6C7C5C'];
const grid = $('[data-portfolio]');
const filter = $('[data-story-filter]');
let items = [];
let active = '';

function render() {
  const list = active ? items.filter((i) => i.category === active) : items;
  grid.innerHTML = list.map((s, i) => html`
    <article class="card reveal${s.featured && !active ? ' story-feature' : ''}${s.wide && !active ? ' story-wide' : ''}" role="listitem" style="--i:${i % 8};">
      <a class="card-link" href="/stories/${s.slug}">
        <div class="pin" style="background:${PIN[i % 4]};"></div>
        <div class="story-art"><img src="${storyImage(s)}" alt="${s.title}" loading="lazy"></div>
        <h3>${s.title}</h3>
        <p>${s.memory}</p>
      </a>
    </article>`).join('');
  reveal(grid);
}

(async () => {
  ({ items } = await get('/portfolio'));
  const cats = [...new Set(items.map((i) => i.category).filter(Boolean))];
  filter.innerHTML = [''].concat(cats).map((c) => html`<button class="chip${c === active ? ' is-active' : ''}" type="button" data-cat="${c}">${c || 'All stories'}</button>`).join('');
  filter.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    active = b.dataset.cat;
    filter.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === b));
    render();
  });
  render();
})();
