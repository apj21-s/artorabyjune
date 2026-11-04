import { $, $$, html, raw, inr, fmtDate } from '../core/dom.js';
import { get, post } from '../core/api.js';
import { initLayout, wireAddToCart, bootstrap } from '../core/layout.js';
import { reveal, toast, toastError, busy } from '../core/ui.js';
import { productCard, emptyState, saveButton } from '../core/components.js';
import { addToCart } from '../core/cart.js';
import { pushRecent, getRecent, recentRow } from '../core/recent.js';
import { prefersReducedMotion } from '../core/dom.js';

initLayout();

const products = new Map();
wireAddToCart((id) => products.get(id));

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
const root = $('[data-product]');

function deliveryWindow(site) {
  const [, max] = String(site.deliveryDays || '3–7').split(/[–-]/).map((n) => Number(n));
  const [, dmax] = String(site.dispatchDays || '2–3').split(/[–-]/).map((n) => Number(n));
  const days = (max || 7) + (dmax || 3);
  const by = new Date(Date.now() + days * 86400000);
  return fmtDate(by, { weekday: 'short', day: 'numeric', month: 'short' });
}

function render(p, site) {
  document.title = `${p.title} · Artora by June`;
  $('[data-crumb]').textContent = p.title;
  const images = p.images.length ? p.images : ['/assets/totes/sunday-sun.svg'];
  const stockNote = !p.inStock
    ? '<span class="stock-note is-out">Sold out</span>'
    : p.lowStock ? '<span class="stock-note is-low">Only a few left, painted by hand</span>' : '<span class="stock-note">In stock, ready to ship</span>';

  root.innerHTML = html`
    <div class="product-gallery">
      <div class="gallery-swipe" data-swipe aria-label="Photos">${images.map((src, i) => raw(html`<img src="${src}" alt="${i ? '' : `Photo of the ${p.title}`}" width="640" height="800" ${i ? 'loading="lazy"' : ''}>`))}</div>
      ${images.length > 1 ? raw(html`<div class="gallery-dots" aria-hidden="true">${images.map((_, i) => raw(`<i class="${i ? '' : 'on'}"></i>`))}</div>`) : ''}
      <div class="gallery-main" data-zoom>
        <img src="${images[0]}" alt="Photo of the ${p.title} ${p.kind === 'giftcard' ? 'gift card' : 'tote'}" width="640" height="800" fetchpriority="high" data-main-image>
        <button class="gallery-expand" type="button" data-lightbox aria-label="Open full-size photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      </div>
      ${images.length > 1 ? raw(html`<div class="gallery-thumbs" role="group" aria-label="More photos">${images.map((src, i) => raw(html`
        <button type="button" class="${i === 0 ? 'is-active' : ''}" data-thumb="${src}" aria-label="Photo ${i + 1}"><img src="${src}" alt="" loading="lazy"></button>`))}</div>`) : ''}
    </div>
    <div class="product-info">
      ${p.badge ? raw(html`<span class="tape tape-cherry">${p.badge}</span>`) : ''}
      <h1>${p.title}</h1>
      <span class="price-stamp">${inr(p.price)}${p.compareAt && p.compareAt > p.price ? raw(html`<s>${inr(p.compareAt)}</s>`) : ''}</span>
      ${raw(stockNote)}
      <p class="lead">${p.summary}</p>
      ${p.inStock ? raw(html`
        <div class="buy-row">
          <button class="btn btn-primary btn-lg" type="button" data-add-to-cart="${p.id}">Add to bag</button>
          <a class="btn btn-ghost btn-lg" href="/checkout" data-buy-now>Buy now</a>
          ${p.kind === 'giftcard' ? '' : raw(saveButton(p, 'save-btn-lg'))}
        </div>
        ${p.kind === 'giftcard'
    ? raw('<p class="ship-estimate">Emailed instantly once paid, with your note. Add the recipient at checkout.</p>')
    : raw(html`<p class="ship-estimate">Order today, arrives around <strong>${deliveryWindow(site)}</strong>${site.freeShippingAbove ? raw(html` · free shipping over ${inr(site.freeShippingAbove)}`) : ''}</p>`)}
        <div data-bundle></div>`) : raw(html`
        <form class="notify-form" data-notify novalidate>
          <label class="sr-only" for="notifyEmail">Email</label>
          <input id="notifyEmail" type="email" required placeholder="your email" autocomplete="email">
          <button class="btn btn-primary" type="submit">Tell me when it’s back</button>
        </form>`)}
      ${p.kind === 'giftcard' ? '' : raw('<div class="handmade-note">Painted by hand, so yours may differ very slightly from the photos. That’s how you know it’s real.</div>')}
      <div class="spec-list">
        ${p.description ? raw(html`<details open><summary>The story</summary><div class="spec-body">${p.description}</div></details>`) : ''}
        <details><summary>Size &amp; material</summary><div class="spec-body">${[p.details.size, p.details.material].filter(Boolean).join('\n') || 'Heavy cotton canvas tote, approx. 38 × 42 cm with a 10 cm gusset.'}</div></details>
        <details><summary>Care</summary><div class="spec-body">${p.details.care || 'Hand-wash cold, inside out. Don’t scrub the painted area. Dry in shade.'}</div></details>
        <details><summary>Shipping &amp; returns</summary><div class="spec-body">Dispatched in ${site.dispatchDays || '2–3'} working days, tracked pan-India. Unused ready-made totes can be returned within 7 days. <a href="/shipping-returns">Full policy</a>.</div></details>
      </div>
      <aside class="cross-sell" style="margin:28px 0 0;padding:22px 24px;">
        <div><h2 style="font-size:1.2rem;margin:0">Want it personalised?</h2><p>June can paint your own memory onto a tote like this.</p></div>
        <a class="btn btn-primary btn-sm" href="/commission">Commission instead</a>
      </aside>
    </div>`;

  wireGallery(p);
  renderBundle(p);
  // Phones: keep "Add to bag" within thumb reach once the main button scrolls away.
  const mainBtn = $('.buy-row [data-add-to-cart]');
  if (mainBtn && 'IntersectionObserver' in window) {
    const bar = document.createElement('div');
    bar.className = 'buy-bar';
    bar.innerHTML = html`<div><strong>${p.title}</strong><span>${inr(p.price)}</span></div><button class="btn btn-primary" type="button" data-add-to-cart="${p.id}">Add to bag</button>`;
    document.body.appendChild(bar);
    new IntersectionObserver(([e]) => bar.classList.toggle('is-shown', !e.isIntersecting && e.boundingClientRect.top < 0)).observe(mainBtn);
  }
  $('[data-buy-now]')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('[data-add-to-cart]').click();
    setTimeout(() => { location.href = '/checkout'; }, 350);
  });
  $('[data-notify]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#notifyEmail');
    if (!input.checkValidity()) { toast('Please enter a valid email.', { type: 'error' }); return; }
    await busy(e.target.querySelector('button'), async () => {
      try {
        await post('/subscribe', { email: input.value.trim(), kind: 'restock', productId: p.id });
        e.target.innerHTML = '<p class="stock-note">We’ll email you the moment it’s back.</p>';
      } catch (error) { toastError(error); }
    });
  });
}

// "Better together": when June has paired this tote with another, offer both at the bundle price.
async function renderBundle(p) {
  const slot = $('[data-bundle]');
  if (!slot || !p.bundleWith || !p.bundleDiscount) return;
  try {
    const { items } = await get(`/products?ids=${p.bundleWith}`);
    const partner = items[0];
    if (!partner?.inStock) return;
    products.set(partner.id, partner);
    const together = p.price + partner.price - p.bundleDiscount;
    slot.innerHTML = html`
      <div class="bundle-card">
        <p class="bundle-title">Better together <span>save ${inr(p.bundleDiscount)}</span></p>
        <div class="bundle-pair">
          <img src="${p.images[0]}" alt="${p.title}"><span class="bundle-plus" aria-hidden="true">+</span>
          <a href="/shop/${partner.slug}"><img src="${partner.images[0]}" alt="${partner.title}"></a>
          <div><strong>${partner.title}</strong><p class="muted">Both for <strong>${inr(together)}</strong> <s>${inr(p.price + partner.price)}</s></p></div>
        </div>
        <button class="btn btn-cherry btn-sm" type="button" data-add-both>Add both to bag</button>
      </div>`;
    $('[data-add-both]').addEventListener('click', (e) => {
      addToCart(p, 1);
      addToCart(partner, 1);
      toast(`Both are in your bag — ${inr(p.bundleDiscount)} comes off at checkout.`);
      e.currentTarget.textContent = 'Added ✓';
    });
  } catch { /* no bundle shown */ }
}

// Full-size photo: click to zoom 2×, move to pan, Esc or the button to close. Pinch works on phones.
function openLightbox(src, alt) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', alt);
  box.innerHTML = html`<button class="lightbox-close icon-btn" type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="lightbox-stage"><img src="${src}" alt="${alt}"></div><p class="lightbox-hint">Click to zoom · drag to look closer</p>`;
  document.body.appendChild(box);
  document.body.style.overflow = 'hidden';
  const img = box.querySelector('img');
  const stage = box.querySelector('.lightbox-stage');
  const close = () => { box.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); $('[data-lightbox]')?.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.querySelector('.lightbox-close').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  stage.addEventListener('click', (e) => {
    const r = img.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    img.classList.toggle('is-zoomed');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!img.classList.contains('is-zoomed')) return;
    const r = stage.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  });
  if (!prefersReducedMotion()) box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  box.querySelector('.lightbox-close').focus();
}

function wireSwipe() {
  const track = $('[data-swipe]');
  const dots = $$('.gallery-dots i');
  if (!track || !dots.length) return;
  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach((d, n) => d.classList.toggle('on', n === i));
  }, { passive: true });
}

function wireGallery(p) {
  wireSwipe();
  $('[data-lightbox]')?.addEventListener('click', (e) => { e.stopPropagation(); openLightbox($('[data-main-image]').src, p.title); });
  const main = $('[data-main-image]');
  const zoom = $('[data-zoom]');
  $$('[data-thumb]').forEach((btn) => btn.addEventListener('click', () => {
    main.src = btn.dataset.thumb;
    $$('[data-thumb]').forEach((b) => b.classList.toggle('is-active', b === btn));
  }));
  zoom.addEventListener('click', (e) => {
    const r = zoom.getBoundingClientRect();
    zoom.style.setProperty('--zx', `${((e.clientX - r.left) / r.width) * 100}%`);
    zoom.style.setProperty('--zy', `${((e.clientY - r.top) / r.height) * 100}%`);
    zoom.classList.toggle('is-zoomed');
  });
  zoom.addEventListener('mousemove', (e) => {
    if (!zoom.classList.contains('is-zoomed')) return;
    const r = zoom.getBoundingClientRect();
    zoom.style.setProperty('--zx', `${((e.clientX - r.left) / r.width) * 100}%`);
    zoom.style.setProperty('--zy', `${((e.clientY - r.top) / r.height) * 100}%`);
  });
  zoom.addEventListener('mouseleave', () => zoom.classList.remove('is-zoomed'));
}

(async () => {
  try {
    const [{ item, related }, { site }] = await Promise.all([get(`/products/${encodeURIComponent(slug)}`), bootstrap()]);
    products.set(item.id, item);
    render(item, site);
    const recent = getRecent(item.id);
    pushRecent(item);
    if (recent.length) {
      $('[data-recent]').innerHTML = recentRow(recent.slice(0, 6));
      $('[data-recent-wrap]').hidden = false;
    }
    if (related.length) {
      related.forEach((p) => products.set(p.id, p));
      $('[data-related]').innerHTML = related.map(productCard).join('');
      $('[data-related-wrap]').hidden = false;
      reveal();
    }
  } catch (error) {
    root.innerHTML = emptyState({ title: 'That tote has left the studio.', body: error.message, cta: 'Back to the shop', href: '/shop' });
  }
})();
