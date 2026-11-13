import { $, $$, html, raw, inr, formData } from '../core/dom.js';
import { get, post } from '../core/api.js';
import { initLayout, bootstrap, session } from '../core/layout.js';
import { getCart, clearCart, onCartChange, setQty, addToCart } from '../core/cart.js';
import { toast, toastError, validateForm, handleFormError, showFieldError, clearErrors } from '../core/ui.js';
import { renderUpiPanel } from '../core/upi-pay.js';
import { emptyState } from '../core/components.js';

initLayout();

const form = $('[data-checkout]');
const linesEl = $('[data-summary-lines]');
const totalsEl = $('[data-totals]');
let coupon = '';
let giftCode = '';
let quote = null;

// ---------- Steps: 1 details → 2 pay by UPI → 3 done ----------
// The order is created when step 1 is submitted, so steps 2 and 3 survive a refresh.
const SAVED = 'artora.checkout';
const readSaved = () => { try { return JSON.parse(sessionStorage.getItem(SAVED) || 'null'); } catch { return null; } };
const writeSaved = (v) => { try { if (v) sessionStorage.setItem(SAVED, JSON.stringify(v)); else sessionStorage.removeItem(SAVED); } catch { /* private mode */ } };
const orderLink = (number, token) => `/order/${encodeURIComponent(number)}?t=${encodeURIComponent(token)}`;
const TITLES = { 1: 'Almost yours.', 2: 'Pay by UPI.', 3: 'Thank you.' };

function showStep(n) {
  $$('[data-step-panel]').forEach((p) => { p.hidden = p.dataset.stepPanel !== String(n); });
  $$('[data-step-mark]').forEach((li) => {
    const k = Number(li.dataset.stepMark);
    li.classList.toggle('is-done', k < n);
    li.classList.toggle('is-current', k === n);
    if (k === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('[data-step-title]').textContent = TITLES[n];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showPay({ number, token, payment }) {
  $('[data-co-number]').textContent = number;
  $('[data-co-order-link]').href = orderLink(number, token);
  renderUpiPanel($('[data-upi-panel]'), {
    payment,
    number,
    token,
    onSubmitted: (order) => showDone({ number, token, email: order.email }),
  });
  showStep(2);
}

function showDone({ number, token, email }) {
  writeSaved(null);
  $('[data-done-number]').textContent = `Order · ${number}`;
  $('[data-done-link]').href = orderLink(number, token);
  $('[data-done-mail]').textContent = `A note is on its way to ${email || 'your email'}. Don’t see it in a few minutes? Check spam or promotions and mark it “Not spam”, so June’s confirmation reaches your inbox.`;
  history.replaceState({ step: 3 }, '', '/checkout?step=done');
  showStep(3);
}

// Back from the payment step: the order already exists, so stay here instead of losing it.
window.addEventListener('popstate', () => {
  const saved = readSaved();
  if (saved && !$('[data-step-panel="2"]').hidden) {
    history.pushState({ step: 2 }, '', '/checkout?step=pay');
    toast('Your order is saved. Pay here, or later from the order page.');
  }
});

// ---------- Email code (proves the address is real) ----------
const codeBox = $('[data-email-code]');
let emailProof = '';
let provenEmail = '';
let codesOff = false;
const currentEmail = () => form.email.value.trim().toLowerCase();
const emailIsProven = () => codesOff || (provenEmail && provenEmail === currentEmail());

function setEmailState() {
  const ok = emailIsProven();
  $('[data-email-ok]').hidden = !ok || codesOff;
  $('[data-send-code]').hidden = ok;
  $('[data-code-why]').hidden = ok;
  if (ok) { $('[data-code-row]').hidden = true; $('[data-code-hint]').hidden = true; }
  form.email.readOnly = Boolean(ok && !codesOff);
}

let resendTimer;
function startResendCountdown(seconds = 30) {
  const btn = $('[data-send-code]');
  clearInterval(resendTimer);
  let left = seconds;
  btn.hidden = false;
  btn.disabled = true;
  btn.textContent = `Send again in ${left}s`;
  resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = 'Send the code again'; return; }
    btn.textContent = `Send again in ${left}s`;
  }, 1000);
}

async function sendCode() {
  clearErrors(form);
  if (!form.email.value.trim() || !form.email.checkValidity()) {
    showFieldError(form, 'email', 'Please enter a valid email address first.');
    return;
  }
  const btn = $('[data-send-code]');
  btn.disabled = true;
  try {
    const res = await post('/checkout/email-code', { email: currentEmail() });
    if (res.disabled) { codesOff = true; setEmailState(); return; }
    $('[data-code-row]').hidden = false;
    const hint = $('[data-code-hint]');
    hint.hidden = false;
    hint.textContent = `Sent to ${currentEmail()}. It can take a minute; check spam too.`;
    $('#coCode').focus();
    startResendCountdown();
  } catch (error) {
    btn.disabled = false;
    if (error.status === 429) {
      // A code went out moments ago (e.g. before a refresh): let them type that one.
      $('[data-code-row]').hidden = false;
      const hint = $('[data-code-hint]');
      hint.hidden = false;
      hint.textContent = `We sent a code to ${currentEmail()} a moment ago. Enter it here, or wait to get a new one.`;
      const wait = Number(/(\d+) seconds/.exec(error.message)?.[1]);
      if (wait) { startResendCountdown(wait); $('#coCode').focus(); return; }
    }
    handleFormError(form, error);
  }
}

async function verifyCode() {
  const code = $('#coCode').value.trim();
  clearErrors(form);
  if (!/^\d{6}$/.test(code)) { showFieldError(form, 'emailCode', 'The code is 6 digits.'); return; }
  const btn = $('[data-verify-code]');
  btn.disabled = true;
  try {
    const res = await post('/checkout/email-code/verify', { email: currentEmail(), code });
    emailProof = res.emailProof;
    provenEmail = currentEmail();
    clearInterval(resendTimer);
    $('[data-send-code]').textContent = 'Send me the code';
    $('[data-send-code]').disabled = false;
    setEmailState();
  } catch (error) {
    if (!showFieldError(form, 'emailCode', error.message)) toastError(error);
  } finally {
    btn.disabled = false;
  }
}

$('[data-send-code]').addEventListener('click', sendCode);
$('[data-verify-code]').addEventListener('click', verifyCode);
$('#coCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value.length === 6) verifyCode();
});
$('#coCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verifyCode(); } });
$('[data-change-email]').addEventListener('click', () => {
  provenEmail = '';
  emailProof = '';
  form.email.readOnly = false;
  setEmailState();
  form.email.focus();
});
form.email.addEventListener('input', setEmailState);

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
  // Phones: the summary collapses to one tappable line.
  let toggle = $('[data-summary-toggle]');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'summary-toggle';
    toggle.dataset.summaryToggle = '';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      $('[data-summary]').classList.toggle('is-open', open);
    });
    $('[data-summary]').prepend(toggle);
  }
  const itemCount = quote.lines.reduce((n, l) => n + l.qty, 0);
  toggle.innerHTML = html`<span>Order summary · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}</span><strong>${inr(quote.total)}</strong>`;
  $('[data-pay]').textContent = quote.total ? `Continue to pay ${inr(quote.total)}` : 'Place order (covered by gift card)';
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
  if (!emailIsProven()) {
    showFieldError(form, 'email', 'Please confirm your email with the code first.');
    if ($('[data-code-row]').hidden) sendCode();
    return;
  }
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
      emailProof,
    });
    // The order exists now; the bag has done its job.
    clearCart();
    if (!result.payment || result.payment.provider === 'none') {
      location.href = `${orderLink(result.number, result.token)}&welcome=1`;
      return;
    }
    writeSaved({ number: result.number, token: result.token });
    history.pushState({ step: 2 }, '', '/checkout?step=pay');
    showPay({ number: result.number, token: result.token, payment: result.payment });
  } catch (error) {
    if (error?.data?.problems) refresh();
    if (error?.data?.needsEmailCode) { provenEmail = ''; emailProof = ''; setEmailState(); }
    handleFormError(form, error);
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
});

// Refresh or return during step 2: pick the saved order back up.
async function resumeSaved() {
  const step = new URLSearchParams(location.search).get('step');
  const saved = readSaved();
  if (!saved || step !== 'pay') { if (step) history.replaceState(null, '', '/checkout'); return false; }
  try {
    const res = await get(`/orders/${encodeURIComponent(saved.number)}?t=${encodeURIComponent(saved.token)}`);
    if (!res.payment) { writeSaved(null); location.replace(orderLink(saved.number, saved.token)); return true; }
    showPay({ number: saved.number, token: saved.token, payment: res.payment });
    return true;
  } catch {
    writeSaved(null);
    return false;
  }
}

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
  if (await resumeSaved()) return;
  await restoreBag();
  const [{ site }, user] = await Promise.all([bootstrap(), session()]);

  if (site.giftWrapFee) $('[data-giftwrap-fee]').textContent = `(+${inr(site.giftWrapFee)})`;
  if (user) {
    form.name.value = user.name || '';
    form.email.value = user.email || '';
    form.phone.value = user.phone || '';
    // A confirmed account email needs no code (the server checks the session too).
    if (user.emailVerified) provenEmail = (user.email || '').toLowerCase();
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
  setEmailState();
  refresh();
})();

onCartChange(() => { if (!$('[data-step-panel="1"]').hidden) refresh(); });
