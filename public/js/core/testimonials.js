// Animated testimonials: a stack of photos where the active one lifts to the front,
// beside the review, which fades in word by word. Plain JS port of the "AnimatedTestimonials" pattern.
import { $, $$, html, raw, prefersReducedMotion } from './dom.js';
import { stars } from './components.js';

// Paintings used when a review has no photo yet (pick one in Admin → Reviews).
const FALLBACK_ART = ['/assets/art/pet.svg', '/assets/art/couple.svg', '/assets/art/sunday.svg', '/assets/art/skyline.svg', '/assets/art/nature.svg', '/assets/art/movie.svg', '/assets/art/fandom.svg', '/assets/art/words.svg'];

const ARROW = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

// A fresh tilt between -10° and 10° for the cards behind, like a loose pile of prints.
const randomTilt = () => Math.floor(Math.random() * 21) - 10;

export function mountTestimonials(root, reviews, { interval = 6000 } = {}) {
  const items = reviews.map((r, i) => ({ ...r, src: r.photo || FALLBACK_ART[i % FALLBACK_ART.length] }));
  if (!items.length) return;
  const reduce = prefersReducedMotion();
  let active = 0;
  let timer = null;
  let visible = false;
  let paused = false;

  root.classList.add('tm');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'carousel');
  root.setAttribute('aria-label', 'Customer reviews');
  root.innerHTML = html`
    <div class="tm-stack" aria-hidden="true">${items.map((t, i) => raw(html`
      <figure class="tm-card" style="--tilt:${randomTilt()}deg; z-index:${items.length + 2 - i}"><img src="${t.src}" alt="" draggable="false" loading="lazy" width="500" height="500"></figure>`))}
    </div>
    <div class="tm-body">
      <div class="tm-text" aria-live="polite"></div>
      <div class="tm-nav">
        <button type="button" class="tm-btn tm-prev" aria-label="Previous review">${raw(ARROW('M19 12H5M11 18l-6-6 6-6'))}</button>
        <button type="button" class="tm-btn tm-next" aria-label="Next review">${raw(ARROW('M5 12h14M13 6l6 6-6 6'))}</button>
        <span class="tm-count" aria-hidden="true"></span>
      </div>
    </div>`;

  const cards = $$('.tm-card', root);
  const text = $('.tm-text', root);
  const count = $('.tm-count', root);

  function render() {
    cards.forEach((card, i) => {
      const on = i === active;
      card.classList.toggle('is-active', on);
      card.style.zIndex = on ? 999 : items.length + 2 - i;
      if (!on) card.style.setProperty('--tilt', `${randomTilt()}deg`);
      if (on && !reduce) {
        card.classList.remove('is-lifting');
        void card.offsetWidth; // restart the lift animation
        card.classList.add('is-lifting');
      }
    });
    const t = items[active];
    const words = `“${t.text}”`.split(/\s+/);
    text.innerHTML = html`
      <h3>${t.name}</h3>
      <p class="tm-meta"><span class="stars" aria-label="${t.rating} out of 5">${stars(t.rating)}</span>${t.city ? raw(html`<span>${t.city}</span>`) : ''}</p>
      <blockquote>${raw(words.map((w, i) => html`<span style="--d:${Math.min(i, 60) * 20}ms">${w}</span>`).join(' '))}</blockquote>`;
    count.textContent = `${String(active + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
  }

  const go = (step) => { active = (active + step + items.length) % items.length; render(); restart(); };

  function restart() {
    clearInterval(timer);
    timer = null;
    if (reduce || paused || !visible || items.length < 2) return;
    timer = setInterval(() => { active = (active + 1) % items.length; render(); }, interval);
  }

  $('.tm-prev', root).addEventListener('click', () => go(-1));
  $('.tm-next', root).addEventListener('click', () => go(1));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });
  ['mouseenter', 'focusin'].forEach((ev) => root.addEventListener(ev, () => { paused = true; restart(); }));
  ['mouseleave', 'focusout'].forEach((ev) => root.addEventListener(ev, () => { paused = false; restart(); }));

  // Swipe on touch screens.
  let startX = null;
  root.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    startX = null;
  });

  // Only autoplay while the section is on screen.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; restart(); }, { threshold: 0.35 }).observe(root);
  }

  render();
}
