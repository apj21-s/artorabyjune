// Runs on every storefront page: header, menus, cart drawer, loading screen, newsletter.
import { $, $$, esc, html, raw, inr, prefersReducedMotion } from './dom.js';
import { get, post } from './api.js';
import { getCart, onCartChange, setQty, removeFromCart, addToCart, cartCount, cartSubtotal } from './cart.js';
import { showSheet, hideSheet, wireSheets, toast, toastError, splat, reveal, busy } from './ui.js';
import { emptyState } from './components.js';
import { wireSearch } from './search.js';
import { toggleSaved, syncSaved, onSavedChange } from './saved.js';

let bootstrapPromise;
export function bootstrap() {
  bootstrapPromise = bootstrapPromise || get('/bootstrap').catch(() => ({ site: {}, tiers: [], gifting: [], reviews: { count: 0 }, features: {} }));
  return bootstrapPromise;
}

let sessionPromise;
export function session() {
  sessionPromise = sessionPromise || get('/auth/me').then((r) => r.user).catch(() => null);
  return sessionPromise;
}

function buildLoadingText() {
  $$('[data-loading-text]').forEach((node) => {
    const word = $('.loading-word', node);
    if (!word) return;
    const chars = Array.from(node.dataset.loadingText || '');
    word.innerHTML = chars.map((char, i) => `<span class="lw-char" style="--i:${i}">${char === ' ' ? '&nbsp;' : esc(char)}</span>`).join('');
  });
}

// The loading screen is a brand moment on the first visit only; later page views skip it.
function finishLoading() {
  const root = document.documentElement;
  const seen = sessionStorageSafe('artora.seenLoader');
  const done = () => {
    root.classList.remove('is-loading');
    root.classList.add('is-ready');
    setTimeout(() => $('#loadingScreen')?.remove(), 1800);
  };
  if (seen || prefersReducedMotion()) {
    $('#loadingScreen')?.remove();
    root.classList.remove('is-loading');
    return;
  }
  sessionStorageSafe('artora.seenLoader', '1');
  // Let the logo finish writing itself (about 2s), but never wait on a slow page beyond that.
  const started = performance.now();
  const finish = () => setTimeout(done, Math.max(250, 2150 - (performance.now() - started)));
  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish, { once: true });
}

function sessionStorageSafe(key, value) {
  try {
    if (value === undefined) return window.sessionStorage.getItem(key);
    window.sessionStorage.setItem(key, value);
  } catch { return null; }
  return value;
}

function markActiveNav() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  $$('.navlinks a, .mobile-links a').forEach((a) => {
    const href = a.getAttribute('href');
    const active = href === path || (href !== '/' && path.startsWith(`${href}/`));
    if (active) a.setAttribute('aria-current', 'page');
  });
}

function wireHeader() {
  const header = $('[data-header]');
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 8);
    // Slide away when scrolling down, come back when scrolling up.
    if (y > 320 && y > lastY + 6) header.classList.add('is-hidden');
    else if (y < lastY - 6 || y < 120) header.classList.remove('is-hidden');
    lastY = y;
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));

  $('[data-menu-open]')?.addEventListener('click', (e) => {
    e.currentTarget.setAttribute('aria-expanded', 'true');
    showSheet($('#mobileMenu'));
  });
  $$('#mobileMenu a').forEach((a) => a.addEventListener('click', () => hideSheet(undefined, false)));
}

// ---------- Cart drawer ----------
function renderCart() {
  const items = getCart();
  const count = cartCount();
  const badge = $('[data-cart-count]');
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = String(count);
  }
  const body = $('[data-cart-body]');
  const foot = $('[data-cart-foot]');
  if (!body) return;
  if (!items.length) {
    body.innerHTML = emptyState({ title: 'Your bag is resting.', body: 'Nothing here yet. Find a tote that feels like you, or commission your own.', cta: 'Browse the shop', href: '/shop' });
    foot.hidden = true;
    return;
  }
  foot.hidden = false;
  body.innerHTML = items.map((i, n) => html`
    <div class="cart-line" style="--i:${n}">
      <img src="${i.image || '/assets/totes/sunday-sun.svg'}" alt="" loading="lazy">
      <div>
        <h3><a href="/shop/${i.slug}">${i.title}</a></h3>
        <span class="price">${inr(i.price)}</span>
        <div class="qty" role="group" aria-label="Quantity for ${i.title}">
          <button type="button" data-qty="${i.productId}" data-delta="-1" aria-label="Decrease">−</button>
          <span>${i.qty}</span>
          <button type="button" data-qty="${i.productId}" data-delta="1" aria-label="Increase">+</button>
        </div>
      </div>
      <button class="remove-line" type="button" data-remove="${i.productId}">Remove</button>
    </div>`).join('');
  const subtotal = cartSubtotal();
  $('[data-cart-subtotal]').textContent = inr(subtotal);
  bootstrap().then(({ site }) => {
    const free = Number(site.freeShippingAbove) || 0;
    const el = $('[data-ship-progress]');
    if (!free || !el) return;
    const left = Math.max(0, free - subtotal);
    const pct = Math.min(100, Math.round((subtotal / free) * 100));
    el.innerHTML = html`${left ? raw(html`You’re <strong>${inr(left)}</strong> away from free shipping.`) : raw('<strong>Free shipping</strong> unlocked ✦')}<div class="bar"><i style="width:${pct}%"></i></div>`;
  });
}

function wireCart() {
  renderCart();
  onCartChange(renderCart);
  $('[data-cart-open]')?.addEventListener('click', () => showSheet($('#cartDrawer')));
  $('#cartDrawer')?.addEventListener('click', (e) => {
    const q = e.target.closest('[data-qty]');
    if (q) {
      const item = getCart().find((i) => i.productId === q.dataset.qty);
      if (item) setQty(item.productId, item.qty + Number(q.dataset.delta));
    }
    const r = e.target.closest('[data-remove]');
    if (r) removeFromCart(r.dataset.remove);
  });
}

// Any [data-add-to-cart="<id>"] button on the page, given a product lookup.
// A small copy of the tote flies in an arc into the bag icon, which then wiggles.
function flyToBag(btn, product) {
  const target = $('[data-cart-open]');
  if (!target || prefersReducedMotion() || !Element.prototype.animate) return;
  const source = btn.closest('article, .product-layout, .product-info')?.querySelector('img');
  const from = (source || btn).getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const size = 64;
  const ghost = document.createElement('img');
  ghost.className = 'fly-tote';
  ghost.src = source?.currentSrc || source?.src || product.images?.[0] || '/assets/totes/sunday-sun.svg';
  ghost.alt = '';
  ghost.style.cssText = `left:${from.left + from.width / 2 - size / 2}px; top:${from.top + from.height / 2 - size / 2}px; width:${size}px; height:${size * 1.25}px;`;
  document.body.appendChild(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const flight = ghost.animate([
    { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(.7) rotate(-14deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(.18) rotate(8deg)`, opacity: 0.2 },
  ], { duration: 720, easing: 'cubic-bezier(.45,0,.3,1)' });
  flight.onfinish = () => {
    ghost.remove();
    target.classList.remove('is-wiggle');
    void target.offsetWidth;
    target.classList.add('is-wiggle');
  };
}

// Headings can mark one word with <em class="brush">; an ochre brush stroke paints under it on first view.
function wireBrushWords() {
  const words = $$('.brush');
  if (!words.length) return;
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) { words.forEach((w) => w.classList.add('is-on')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-on'); io.unobserve(e.target); }
  }), { threshold: 0.8 });
  words.forEach((w) => io.observe(w));
}

export function wireAddToCart(findProduct, root = document) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add-to-cart]');
    if (!btn || btn.disabled) return;
    const product = findProduct(btn.dataset.addToCart);
    if (!product) return;
    addToCart(product, 1);
    const rect = btn.getBoundingClientRect();
    splat(rect.left + rect.width / 2, rect.top + rect.height / 2);
    flyToBag(btn, product);
    const badge = $('[data-cart-count]');
    badge?.classList.remove('is-bumped');
    void badge?.offsetWidth;
    badge?.classList.add('is-bumped');
    toast(`“${product.title}” is in your bag.`);
  });
}

// Heart buttons anywhere on the page. Guests keep the list in this browser; signed-in customers get it in their account.
function wireSaved() {
  const paint = (ids) => $$('[data-save]').forEach((b) => b.setAttribute('aria-pressed', String(ids.includes(b.dataset.save))));
  onSavedChange(paint);
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-save]');
    if (!btn) return;
    e.preventDefault();
    const on = toggleSaved(btn.dataset.save);
    if (on) {
      const r = btn.getBoundingClientRect();
      splat(r.left + r.width / 2, r.top + r.height / 2, 7);
    }
    toast(on ? 'Saved. Find it in your account under “Saved”.' : 'Removed from saved.');
  });
  session().then((user) => { if (user) syncSaved(); });
}

async function wireAccount() {
  const user = await session();
  const label = user ? (user.name || 'Account').split(' ')[0] : 'Sign in';
  $$('[data-account-label]').forEach((el) => {
    el.textContent = label;
    el.closest('a')?.setAttribute('aria-label', user ? `${label}, your account` : 'Sign in');
  });
  $$('[data-account-link]').forEach((a) => {
    a.href = user ? (user.role === 'admin' ? '/account' : '/account') : `/login?next=${encodeURIComponent(location.pathname)}`;
  });
}

function wireNewsletter() {
  $$('[data-newsletter]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (!input.checkValidity()) { toast('Please enter a valid email.', { type: 'error' }); input.focus(); return; }
      await busy(form.querySelector('button'), async () => {
        try {
          await post('/subscribe', { email: input.value.trim(), kind: 'newsletter' });
          form.reset();
          toast('You’re on the list. The first letter is on its way soon.');
        } catch (error) { toastError(error); }
      });
    });
  });
}

async function wireAnnouncement() {
  const { site } = await bootstrap();
  const bar = $('[data-announce]');
  if (bar && site.announcement) {
    $('[data-announce-text]', bar).textContent = site.announcement;
    bar.hidden = false;
  }
}

export function initLayout() {
  buildLoadingText();
  finishLoading();
  wireSheets();
  wireHeader();
  markActiveNav();
  wireCart();
  wireAccount();
  wireNewsletter();
  wireAnnouncement();
  reveal();
  wireBrushWords();
  wireSearch();
  wireSaved();
}
