import { $, $$, html, raw, inr, formData } from '../core/dom.js';
import { get, post } from '../core/api.js';
import { initLayout, bootstrap, session } from '../core/layout.js';
import { getCart, clearCart, onCartChange, setQty, addToCart } from '../core/cart.js';
import { toast, toastError, validateForm, handleFormError } from '../core/ui.js';
import { pay } from '../core/pay.js';
import { emptyState } from '../core/components.js';

initLayout();

const form = $('[data-checkout]');
const linesEl = $('[data-summary-lines]');
const totalsEl = $('[data-totals]');
let coupon = '';
let giftCode = '';
let quote = null;

function cartPayload() {
  return getCart().map((i) => ({ productId: i.productId, qty: i.qty }));
}

async function refresh() {
  const items = cartPayload();
  if (!items.length) {
    $('.checkout-layout').innerHTML = `<div style="grid-column:1/-1">${emptyState({ title: 'Your bag is empty.', body: 'Find a tote first, then come back here.', cta: 'Browse the shop', href: '/shop' })}</div>`;
    return;
  }
  try {
    quote = await post('/cart/quote', { items, couponCode: coupon, giftCode, giftWrap: form['gift.wrap'].checked });
  } catch (error) {
    if (giftCode) {
      toastError(error);
      giftCode = '';
      $('#giftcode').value = '';
      return refresh();
    }
    if (coupon) {
      toastError(error);
      coupon = '';
      $('#coupon').value = '';
      return refresh();
    }
    toastError(error);
    return;
  }
  // Fix up anything that sold out or changed while it sat in the bag.
  quote.problems.forEach((p) => {
    toast(p.message, { type: 'error' });
    const line = getCart().find((i) => i.productId === p.productId);
    if (line) setQty(p.productId, 0);
  });
  render();
}

function render() {
  if (!quote) return;
  linesEl.innerHTML = quote.lines.map((l) => html`
    <div class="summary-line">
      <img src="${l.image || '/assets/totes/sunday-sun.svg'}" alt="">
      <div><strong>${l.title}</strong><div class="muted">Qty ${l.qty}</div></div>
      <span>${inr(l.price * l.qty)}</span>
    </div>`).join('');
  const rows = [
    ['Subtotal', inr(quote.subtotal)],
    quote.bundleDiscount && ['Bundle saving', `−${inr(quote.bundleDiscount)}`, 'saving'],
    quote.discount && [`Coupon ${quote.couponCode}`, `−${inr(quote.discount)}`, 'saving'],
    quote.giftWrapFee && ['Gift wrap', inr(quote.giftWrapFee)],
    quote.needsShipping ? ['Shipping', quote.shippingFee ? inr(quote.shippingFee) : 'Free'] : ['Delivery', 'By email'],
    quote.giftCardAmount && [`Gift card ${quote.giftCardCode}`, `−${inr(quote.giftCardAmount)}`, 'saving'],
  ].filter(Boolean);
  totalsEl.innerHTML = html`
    ${rows.map(([k, v, cls]) => raw(html`<dt class="${cls || ''}">${k}</dt><dd class="${cls || ''}">${v}</dd>`))}
    <dt class="grand">Total</dt><dd class="grand">${inr(quote.total)}</dd>
    ${quote.toFreeShipping > 0 ? raw(html`<dt style="grid-column:1/-1" class="helper-note">Add ${inr(quote.toFreeShipping)} more for free shipping.</dt>`) : ''}`;
  $('[data-pay]').textContent = quote.total ? `Pay ${inr(quote.total)} securely` : 'Place order — covered by gift card';
  // Gift cards are emailed; only show the address when something will be posted.
  const addr = $('[data-address-fields]');
  addr.hidden = !quote.needsShipping;
  addr.querySelectorAll('input').forEach((i) => { if (i.dataset.req === undefined) i.dataset.req = i.required ? '1' : ''; i.required = quote.needsShipping && i.dataset.req === '1'; });
  $('[data-giftcard-fields]').hidden = !quote.hasGiftCards;
  $('[data-gift-toggle]').closest('fieldset').hidden = !quote.needsShipping;
  $('[data-giftcode]').hidden = quote.hasGiftCards;
}

$('[data-giftcode]').addEventListener('submit', async (e) => {
  e.preventDefault();
  giftCode = $('#giftcode').value.trim().toUpperCase();
  await refresh();
  if (giftCode && quote?.giftCardCode) toast(`Gift card applied: ${inr(quote.giftCardAmount)} off. ${quote.giftCardBalance ? `${inr(quote.giftCardBalance)} stays on the card.` : ''}`);
});

// Remember the bag against this email, for one gentle reminder if checkout isn't finished.
form.email.addEventListener('change', () => {
  if (!form.email.checkValidity() || !cartPayload().length) return;
  post('/cart/draft', { email: form.email.value.trim(), items: cartPayload() }).catch(() => {});
});

$('[data-coupon]').addEventListener('submit', async (e) => {
  e.preventDefault();
  coupon = $('#coupon').value.trim().toUpperCase();
  await refresh();
  if (coupon && quote?.couponCode) toast(`Coupon ${quote.couponCode} applied.`);
});

form.addEventListener('change', (e) => {
  if (e.target.matches('[data-giftwrap]')) refresh();
  if (e.target.matches('[data-gift-toggle]')) $('[data-gift-fields]').hidden = !e.target.checked;
});

// Pincode → city/state (India Post public API). Optional nicety; fails silently.
const pin = $('[data-pincode]');
pin.addEventListener('input', async () => {
  pin.value = pin.value.replace(/\D/g, '').slice(0, 6);
  if (pin.value.length !== 6) return;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin.value}`);
    const [data] = await res.json();
    const po = data?.PostOffice?.[0];
    if (po) {
      if (!form['address.city'].value) form['address.city'].value = po.District;
      if (!form['address.state'].value) form['address.state'].value = po.State;
    }
  } catch { /* offline or blocked: user types it */ }
});

// Copy contact details into the delivery fields when they are blank.
form.name.addEventListener('change', () => { if (!form['address.name'].value) form['address.name'].value = form.name.value; });
form.phone.addEventListener('change', () => { if (!form['address.phone'].value) form['address.phone'].value = form.phone.value; });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(form)) return;
  const data = formData(form);
  const button = $('[data-pay]');
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    const result = await post('/checkout', {
      items: cartPayload(),
      couponCode: coupon,
      giftCode,
      giftCard: data.giftCard || {},
      name: data.name,
      email: data.email,
      phone: data.phone,
      address: quote?.needsShipping === false ? undefined : data.address,
      gift: { isGift: Boolean(data.gift?.isGift), note: data.gift?.note || '', wrap: Boolean(data.gift?.wrap) },
    });
    const link = `/order/${encodeURIComponent(result.number)}?t=${encodeURIComponent(result.token)}`;
    const outcome = await pay({ payment: result.payment, number: result.number, token: result.token });
    if (outcome.paid || outcome.manual) {
      clearCart();
      location.href = `${link}&welcome=1`;
      return;
    }
    // Dismissed: the order is saved and can be paid from its page.
    clearCart();
    toast('Payment window closed. Your order is saved — you can pay from the order page.');
    location.href = link;
  } catch (error) {
    if (error?.data?.problems) refresh();
    handleFormError(form, error);
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
});

// The reminder email links here with ?restore=… to put the bag back exactly as it was.
async function restoreBag() {
  const token = new URLSearchParams(location.search).get('restore');
  if (!token) return;
  try {
    const { items } = await get(`/cart/draft/${encodeURIComponent(token)}`);
    if (items.length) {
      clearCart();
      items.forEach((i) => addToCart(i.product, i.qty));
      toast('Your bag is back, just as you left it.');
    }
  } catch (error) { toastError(error); }
  history.replaceState(null, '', location.pathname);
}

(async () => {
  await restoreBag();
  const [{ site }, user] = await Promise.all([bootstrap(), session()]);
  if (site.giftWrapFee) $('[data-giftwrap-fee]').textContent = `(+${inr(site.giftWrapFee)})`;
  if (user) {
    form.name.value = user.name || '';
    form.email.value = user.email || '';
    form.phone.value = user.phone || '';
    try {
      const { addresses } = await get('/me/profile');
      if (addresses?.length) {
        const wrap = $('[data-saved-addresses]');
        wrap.hidden = false;
        wrap.innerHTML = addresses.map((a, i) => html`<button class="chip" type="button" data-address="${i}">${a.label || 'Saved'}: ${a.city}</button>`).join('');
        const fill = (a) => {
          ['name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode'].forEach((k) => { form[`address.${k}`].value = a[k] || ''; });
          $$('[data-address]').forEach((b) => b.classList.toggle('is-active', addresses[b.dataset.address] === a));
        };
        wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-address]'); if (b) fill(addresses[b.dataset.address]); });
        fill(addresses[0]);
      }
    } catch { /* fine */ }
  }
  refresh();
})();

onCartChange(() => refresh());
