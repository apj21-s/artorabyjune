import { $, html, raw } from '../core/dom.js';
import { get } from '../core/api.js';
import { initLayout } from '../core/layout.js';
import { reveal } from '../core/ui.js';
import { storyImage, emptyState } from '../core/components.js';

initLayout();

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
const root = $('[data-story]');

(async () => {
  try {
    const { item, more } = await get(`/portfolio/${encodeURIComponent(slug)}`);
    $('[data-crumb]').textContent = item.title;
    root.innerHTML = html`
      <figure class="polaroid">
        <span class="tape tape-ochre" aria-hidden="true"></span>
        <img src="${storyImage(item)}" alt="${item.title}">
        <figcaption>${item.title}</figcaption>
      </figure>
      <div>
        <span class="eyebrow">${item.category || 'Story'}</span>
        <h1>${item.title}</h1>
        <blockquote class="memory-quote">${item.memory}</blockquote>
        ${item.body ? raw(html`<div class="prose"><p>${item.body}</p></div>`) : ''}
        <div class="hero-ctas">
          <a class="btn btn-primary" href="/commission?memory=${encodeURIComponent(`Something like “${item.title}”: `)}">Paint one like this</a>
          <a class="btn btn-ghost" href="/stories">All stories</a>
        </div>
      </div>`;
    if (more.length) {
      $('[data-more]').innerHTML = more.map((s, i) => html`
        <article class="card reveal" style="--i:${i};"><a class="card-link" href="/stories/${s.slug}">
          <div class="story-art"><img src="${storyImage(s)}" alt="${s.title}" loading="lazy"></div>
          <h3>${s.title}</h3><p>${s.memory}</p></a></article>`).join('');
      $('[data-more]').style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
      $('[data-more-wrap]').hidden = false;
      reveal();
    }
  } catch (error) {
    root.innerHTML = emptyState({ title: 'That story has wandered off.', body: error.message, cta: 'See all stories', href: '/stories' });
  }
})();
