import { $, $$, html, raw, inr, prefersReducedMotion } from '../core/dom.js';
import { get } from '../core/api.js';
import { read, write } from '../core/store.js';
import { initLayout, bootstrap, wireAddToCart } from '../core/layout.js';
import { reveal } from '../core/ui.js';
import { productCard, stars } from '../core/components.js';
import { mountTestimonials } from '../core/testimonials.js';

initLayout();

const products = new Map();
wireAddToCart((id) => products.get(id));

function setText(key, value) {
  if (!value) return;
  $$(`[data-content="${key}"]`).forEach((el) => { el.textContent = value; });
}

async function renderContent() {
  const { site, tiers, reviews } = await bootstrap();
  ['heroEyebrow', 'heroSubtitle'].forEach((k) => setText(k, site[k]));
  if (site.heroTitle) {
    // Keep the painted brush under the last word of the (editable) hero title.
    const words = String(site.heroTitle).trim().split(/\s+/);
    const last = words.pop();
    $$('[data-content="heroTitle"]').forEach((el) => { el.innerHTML = html`${words.join(' ')} <em class="brush is-on">${last}</em>`; });
  }

  const trust = $('[data-trust-text]');
  if (trust) {
    trust.textContent = reviews?.count >= 3
      ? `${reviews.average} from ${reviews.count} stories · Painted by hand · Ships pan-India`
      : (site.trustLine || trust.textContent);
  }

  if (Array.isArray(site.marquee) && site.marquee.length) {
    const words = site.marquee.map((w) => html`<span>${String(w).toUpperCase()}</span>`).join('');
    $('[data-marquee]').innerHTML = words + words;
  }

  const deposit = $('[data-deposit-note]');
  if (deposit && site.depositPercent) deposit.textContent = Number(site.depositPercent) === 50 ? 'Half to begin, the rest before it ships.' : `${site.depositPercent}% to begin, the rest before it ships.`;

  // Tiers hang like price tags on a studio clothesline; the little tote shows the size.
  const list = tiers || [];
  $('[data-tiers]').innerHTML = list.map((t, i) => {
    const size = 30 + Math.round((i / Math.max(1, list.length - 1)) * 26);
    const features = (t.features || []).filter((f) => !/turnaround/i.test(f));
    return html`
    <article class="tier-tag reveal${t.featured ? ' is-feat' : ''}" style="--i:${i}; --tilt:${[-2.4, 1.6, -1.2][i % 3]}deg;">
      <span class="peg" aria-hidden="true"></span>
      <div class="tier-card">
        <div class="tier-head">
          <h3>${t.title}</h3>
          ${t.featured ? raw('<span class="tier-flag">most loved</span>') : ''}
        </div>
        <div class="tier-price-row">
          <p class="tier-price"><small>from</small>${inr(t.price)}</p>
          <svg class="tier-size" viewBox="0 0 40 44" style="width:${size}px" aria-hidden="true"><path d="M13 12 C12 2 28 2 27 12" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M6 12 H34 L36 42 H4 Z" fill="var(--tote-fill)" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><rect x="12" y="19" width="16" height="15" rx="1.5" fill="var(--tote-art)"/></svg>
        </div>
        <p class="tier-days">${t.turnaround}</p>
        <ul>${features.map((f) => raw(html`<li>${f}</li>`))}</ul>
        <a class="btn ${t.featured ? 'btn-cherry' : 'btn-primary'}" href="/commission?tier=${t.key}">Choose ${t.title}</a>
      </div>
    </article>`;
  }).join('');
  wireTierSwitch(list);
  reveal();
}

// On phones/tablets the featured totes are a swipe row; this nudges it to the next card every few seconds.
// Runs nonstop while on screen and loops to the start; off for reduced motion.
function autoSlide(row, every = 3500) {
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;
  let timer = null;
  let visible = false;
  const step = () => {
    if (row.scrollWidth <= row.clientWidth + 4) return; // not a swipe row at this width (desktop grid)
    const card = row.firstElementChild;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const width = (card?.getBoundingClientRect().width || row.clientWidth) + gap;
    const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
    row.scrollTo({ left: atEnd ? 0 : row.scrollLeft + width, behavior: 'smooth' });
  };
  const sync = () => {
    clearInterval(timer);
    timer = visible ? setInterval(step, every) : null;
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.5 }).observe(row);
}

// Phones: three tags in a swipe row are easy to miss, so add a Mini / Classic / Big switcher, dots and a hint.
function wireTierSwitch(list) {
  const row = $('[data-tiers]');
  if (!row || list.length < 2 || $('.tier-switch')) return;
  const sw = document.createElement('div');
  sw.className = 'tier-switch';
  sw.setAttribute('role', 'tablist');
  sw.setAttribute('aria-label', 'Commission sizes');
  sw.innerHTML = list.map((t, i) => html`<button type="button" role="tab" data-tier-go="${i}" aria-selected="${String(i === 0)}">${t.title}<small>${inr(t.price)}</small></button>`).join('');
  row.before(sw);
  const meta = document.createElement('div');
  meta.className = 'tier-meta';
  meta.innerHTML = html`<span class="tier-dots">${list.map((_, i) => raw(`<i class="${i ? '' : 'on'}"></i>`))}</span><span class="tier-hint">swipe to compare →</span>`;
  row.after(meta);
  const cards = [...row.children];
  const go = (i) => row.scrollTo({ left: cards[i].offsetLeft - row.offsetLeft - 16, behavior: 'smooth' });
  sw.addEventListener('click', (e) => { const b = e.target.closest('[data-tier-go]'); if (b) go(Number(b.dataset.tierGo)); });
  let raf = 0;
  row.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const mid = row.scrollLeft + row.clientWidth / 2 + row.offsetLeft;
      let idx = 0;
      cards.forEach((c, i) => { if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[idx].offsetLeft + cards[idx].offsetWidth / 2 - mid)) idx = i; });
      sw.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === idx)));
      meta.querySelectorAll('.tier-dots i').forEach((d, i) => d.classList.toggle('on', i === idx));
      if (row.scrollLeft > 20) meta.classList.add('is-swiped');
    });
  }, { passive: true });
  // Start on the most-loved size so the best option is what people see first.
  const feat = list.findIndex((t) => t.featured);
  if (feat > 0 && row.scrollWidth > row.clientWidth + 4) setTimeout(() => go(feat), 400);
}

async function renderProducts() {
  const wrap = $('[data-featured-products]');
  try {
    let { items } = await get('/products?featured=1&limit=4');
    if (items.length < 4) items = (await get('/products?limit=4')).items;
    items.forEach((p) => products.set(p.id, p));
    if (!items.length) {
      $('#shop-preview').hidden = true;
      return;
    }
    wrap.innerHTML = items.slice(0, 4).map(productCard).join('');
    reveal(wrap);
    autoSlide(wrap);
  } catch {
    $('#shop-preview').hidden = true;
  }
}

async function renderReviews() {
  const wrap = $('[data-reviews]');
  try {
    const { items, summary } = await get('/reviews?limit=8');
    if (!items.length) { $('#reviews').hidden = true; return; }
    mountTestimonials(wrap, items);
    if (summary.count) {
      const el = $('[data-rating-summary]');
      el.innerHTML = html`<span class="stars" aria-hidden="true">${stars(summary.average)}</span> ${summary.average} average · ${summary.count} reviews`;
      el.hidden = false;
    }
  } catch {
    $('#reviews').hidden = true;
  }
}

function wireBeforeAfter() {
  const slider = $('[data-ba]');
  if (!slider) return;
  const range = $('.ba-range', slider);
  const set = (v) => slider.style.setProperty('--pos', `${v}%`);
  range.addEventListener('input', () => set(range.value));
  // A gentle hint the first time it scrolls into view.
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      let t = 0;
      const tick = () => {
        t += 1;
        const v = 50 + Math.sin(t / 14) * 18 * Math.max(0, 1 - t / 90);
        set(v);
        range.value = v;
        if (t < 90) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    io.observe(slider);
  }
}

// "How it works": the three step pictures act out their step one after another (1 → 2 → 3, then again),
// only while the section is on screen. Each card rests on its finished picture when it isn't playing.
function wireSteps() {
  const steps = $$('#how .step');
  const imgs = steps.map((step) => $('.step-spot img', step));
  if (!steps.length || imgs.some((img) => !img) || prefersReducedMotion() || !('IntersectionObserver' in window)) return;
  const PLAY_MS = 5600;
  const REST_MS = 1400;
  let sources;
  const urls = [];
  let index = -1;
  let timer = null;

  steps.forEach((step) => step.insertAdjacentHTML('beforeend', '<span class="step-progress" aria-hidden="true"></span>'));

  const row = steps[0].parentElement;
  const load = () => {
    sources = sources || Promise.all(imgs.map((img) => fetch(img.getAttribute('src').replace('-still', '')).then((r) => r.text())));
    return sources;
  };
  async function play(i) {
    const texts = await load();
    steps.forEach((step, k) => step.classList.toggle('is-playing', k === i));
    if (row.scrollWidth > row.clientWidth + 4) row.scrollTo({ left: steps[i].offsetLeft - row.offsetLeft - 16, behavior: 'smooth' });
    if (urls[i]) URL.revokeObjectURL(urls[i]);
    // A fresh copy of the animated SVG restarts its animation from the beginning.
    urls[i] = URL.createObjectURL(new Blob([texts[i]], { type: 'image/svg+xml' }));
    imgs[i].src = urls[i];
  }
  function next() {
    index = (index + 1) % steps.length;
    play(index).catch(() => {});
    timer = setTimeout(next, PLAY_MS + (index === steps.length - 1 ? REST_MS : 0));
  }
  function stop() {
    clearTimeout(timer);
    timer = null;
    steps.forEach((step) => step.classList.remove('is-playing'));
  }
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !timer) { index = -1; next(); }
    if (!entry.isIntersecting && timer) stop();
  }, { threshold: 0.45 }).observe($('#how'));
}

// The hero tote leans gently toward the pointer (mouse only; off for reduced motion).
function wireHeroTilt() {
  const area = $('.hero-visual');
  const tilt = $('.hero-tilt');
  if (!area || !tilt || prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
  let frame = 0;
  area.addEventListener('pointermove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const r = area.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.setProperty('--ry', `${(x * 12).toFixed(2)}deg`);
      tilt.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
    });
  });
  area.addEventListener('pointerleave', () => { tilt.style.setProperty('--ry', '0deg'); tilt.style.setProperty('--rx', '0deg'); });
}

// Carry the teaser text into the full commission letter.
function wireTeaser() {
  $('[data-letter-teaser]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const story = $('#teaserStory').value.trim();
    const draft = read('artora.commission.draft', {}) || {};
    if (story) draft.story = story;
    write('artora.commission.draft', draft);
    location.href = '/commission';
  });
}

renderContent();
renderProducts();
renderReviews();
wireBeforeAfter();
wireSteps();
wireHeroTilt();
wireTeaser();
