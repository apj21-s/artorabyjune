import { $, html, raw, inr, fmtDate } from '../core/dom.js';
import { get, post } from '../core/api.js';
import { initLayout } from '../core/layout.js';
import { toast, toastError, busy, openModal, validateForm, handleFormError } from '../core/ui.js';
import { pay } from '../core/pay.js';
import { timeline, paymentChip, emptyState } from '../core/components.js';
import { uploadImage } from '../core/upload.js';

initLayout();

const number = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const root = $('[data-order-view]');
let order;

const qs = token ? `?t=${encodeURIComponent(token)}` : '';

function moneyRows(o) {
  const rows = [];
  if (o.type === 'shop') o.items.forEach((i) => rows.push([`${i.title} × ${i.qty}`, inr(i.price * i.qty)]));
  else if (o.status !== 'received' || o.total) rows.push([o.commission?.tierTitle || 'Commission', inr(o.subtotal)]);
  if (o.discount) rows.push([`Coupon ${o.couponCode}`, `−${inr(o.discount)}`]);
  if (o.giftWrapFee) rows.push(['Gift wrap', inr(o.giftWrapFee)]);
  if (o.type === 'shop') rows.push(['Shipping', o.shippingFee ? inr(o.shippingFee) : 'Free']);
  if (o.total) rows.push(['Total', inr(o.total)]);
  if (o.amountPaid) rows.push(['Paid', inr(o.amountPaid)]);
  if (o.balanceDue && o.total) rows.push(['Balance due', inr(o.balanceDue)]);
  return rows;
}

function quoteSection(o) {
  const c = o.commission;
  if (!c || !(o.canApprove || c.sketchImage || c.quoteMessage)) return '';
  // A sketchbook page with June's sketch pinned on it, and the price on a hang tag beside it.
  return html`
    <section class="o-section" id="sketch">
      <h2>${o.canApprove ? 'June’s sketch is ready for you.' : 'Your sketch'}</h2>
      <div class="sketch-spread">
        <figure class="sketchbook">
          <span class="sketchbook-rings" aria-hidden="true"></span>
          ${c.sketchImage ? raw(html`<img src="${c.sketchImage}" alt="Sketch preview of your tote">`) : raw('<div class="sketch-placeholder">The sketch is attached to your email.</div>')}
          <span class="tape tape-ochre sk-tape-a" aria-hidden="true"></span><span class="tape tape-cherry sk-tape-b" aria-hidden="true"></span>
          ${c.quoteMessage ? raw(html`<figcaption class="quote-note">“${c.quoteMessage}” <span class="accent">— June</span></figcaption>`) : ''}
        </figure>
        <div class="tier-tag money-tag" style="--tilt:2deg">
          <span class="peg" aria-hidden="true"></span>
          <div class="tier-card">
            <div class="tier-head"><h3>Your story</h3></div>
            <p class="tier-price"><small>total</small>${inr(o.total)}</p>
            <ul>
              <li>Deposit to begin · <strong>${inr(o.depositAmount)}</strong></li>
              <li>Balance before shipping · <strong>${inr(Math.max(0, o.total - o.depositAmount))}</strong></li>
            </ul>
            ${o.canApprove ? raw(html`
              <form class="coupon-line" data-approve-coupon><label class="sr-only" for="apCoupon">Coupon</label><input id="apCoupon" placeholder="coupon code (optional)"></form>
              <button class="btn btn-primary" type="button" data-approve>Approve &amp; pay ${inr(o.depositAmount)}</button>
              <button class="btn-text" type="button" data-changes>or ask June for changes</button>`) : ''}
          </div>
        </div>
      </div>
    </section>`;
}

function render(o) {
  order = o;
  document.title = `Order ${o.number} · Artora by June`;
  const welcome = params.get('welcome') === '1';
  const rows = moneyRows(o);
  const c = o.commission;
  root.innerHTML = html`
    <div class="order-head">
      <div>
        <span class="order-no">${o.type === 'commission' ? 'Commission' : 'Order'} · ${o.number}</span>
        <h1>${welcome ? 'Thank you — it’s yours.' : o.statusLabel}</h1>
        <div class="meta-row">
          <span>Placed ${fmtDate(o.createdAt)}</span>
          ${raw(paymentChip(o))}
          ${o.tracking?.number ? raw(html`<span class="status-chip">${o.tracking.courier || 'Courier'} · ${o.tracking.number}</span>`) : ''}
        </div>
      </div>
      ${welcome ? raw('<img class="order-welcome-art" src="/assets/june-character.svg" alt="" width="304" height="218">') : ''}
    </div>
    <div class="order-grid">
      ${raw(quoteSection(o))}
      ${o.canPayBalance ? raw(html`
        <section class="o-section o-pay">
          <div><h2>Your story is nearly ready to travel.</h2><p class="muted">Pay the balance and June will ship it.</p></div>
          <div class="tier-tag money-tag" style="--tilt:-2deg"><span class="peg" aria-hidden="true"></span><div class="tier-card">
            <p class="tier-price"><small>balance</small>${inr(o.balanceDue)}</p>
            <button class="btn btn-primary" type="button" data-pay>Pay balance</button>
          </div></div>
        </section>`) : ''}
      ${o.canPayShop ? raw(html`
        <section class="o-section o-pay">
          <div><h2>Payment pending</h2><p class="muted">Your order is saved. Complete the payment to reserve it.</p></div>
          <div class="tier-tag money-tag" style="--tilt:-2deg"><span class="peg" aria-hidden="true"></span><div class="tier-card">
            <p class="tier-price"><small>to pay</small>${inr(o.total)}</p>
            <button class="btn btn-primary" type="button" data-pay>Pay now</button>
          </div></div>
        </section>`) : ''}
      ${o.status === 'delivered' ? raw(html`
        <section class="o-section" id="review">
          <h2>How does it feel?</h2>
          <form class="stack crumpled note-form" data-review-form novalidate>
            <div class="stars-input" role="radiogroup" aria-label="Rating">
              ${[5, 4, 3, 2, 1].map((n) => raw(html`<input type="radio" name="rating" id="star${n}" value="${n}" ${n === 5 ? 'checked' : ''}><label for="star${n}" title="${n} stars">★</label>`))}
            </div>
            <div class="field"><label for="rvText">A few words</label><textarea id="rvText" name="text" rows="3" required minlength="5"></textarea></div>
            <div class="field-pair">
              <div class="field"><label for="rvCity">Your city (optional)</label><input id="rvCity" name="city"></div>
              <div class="field"><label for="rvPhoto">A photo (optional)</label><input id="rvPhoto" type="file" accept="image/*"></div>
            </div>
            <button class="btn btn-primary" type="submit">Send to June</button>
          </form>
        </section>`) : ''}
      <section class="o-section">
        <h2>Timeline</h2>
        ${raw(timeline(o.timeline))}
        ${o.tracking?.url ? raw(html`<a class="btn btn-ghost btn-sm" href="${o.tracking.url}" target="_blank" rel="noopener">Track the parcel ↗</a>`) : ''}
      </section>
      ${c ? raw(html`
        <section class="o-section">
          <h2>Your letter to June</h2>
          <div class="letter-review crumpled letter-copy"><dl>
            <dt>Canvas</dt><dd>${c.tierTitle} · ${c.style} · ${c.baseColour}</dd>
            ${c.occasion ? raw(html`<dt>Occasion</dt><dd>${c.occasion}</dd>`) : ''}
            <dt>Story</dt><dd>${c.story}</dd>
            ${c.include ? raw(html`<dt>Include</dt><dd>${c.include}</dd>`) : ''}
            ${c.deadline ? raw(html`<dt>Needed by</dt><dd>${fmtDate(c.deadline)}</dd>`) : ''}
          </dl></div>
          ${c.references?.length ? raw(html`<div class="ref-strip" style="margin-top:14px">${c.references.map((u) => raw(html`<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Reference photo" loading="lazy"></a>`))}</div>`) : ''}
        </section>`) : ''}
      ${rows.length ? raw(html`
        <section class="o-section">
          <h2>Summary</h2>
          <div class="receipt">
            <p class="receipt-head">Artora by June · ${o.number}</p>
            <dl class="totals">${rows.map(([k, v]) => raw(html`<dt>${k}</dt><dd>${v}</dd>`))}</dl>
            ${o.shippingAddress?.line1 ? raw(html`<p class="receipt-foot">Ships to ${o.shippingAddress.name}, ${o.shippingAddress.line1}, ${o.shippingAddress.city} ${o.shippingAddress.pincode}</p>`) : ''}
            <p class="receipt-thanks">thank you ♥</p>
          </div>
        </section>`) : ''}
      <p class="helper-note center">Questions? <a href="/contact">Write to June</a> and mention ${o.number}. <a href="/account">Sign in</a> to see all your orders in one place.</p>
    </div>`;
  wire();
}

async function runPayment(payment) {
  const outcome = await pay({ payment, number: order.number, token });
  if (outcome.paid) {
    toast('Payment received. Thank you!');
    render(outcome.order);
  } else if (outcome.manual) {
    load();
  }
}

function wire() {
  $('[data-approve]')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      const couponCode = $('#apCoupon')?.value.trim() || '';
      const result = await post(`/orders/${encodeURIComponent(number)}/approve${qs}`, { couponCode });
      if (result.order.depositAmount !== order.depositAmount) toast(`Coupon applied. New deposit: ${inr(result.order.depositAmount)}.`);
      order = result.order;
      await runPayment(result.payment);
    } catch (error) { toastError(error); }
  }));

  $('[data-pay]')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      const { payment } = await post(`/orders/${encodeURIComponent(number)}/pay${qs}`, {});
      await runPayment(payment);
    } catch (error) { toastError(error); }
  }));

  $('[data-changes]')?.addEventListener('click', () => {
    openModal({
      title: 'What would you like changed?',
      body: html`<form class="stack" data-changes-form novalidate>
        <div class="field"><label for="chMsg">Tell June</label><textarea id="chMsg" name="message" rows="4" required minlength="3" placeholder="e.g. could the dog be a little fluffier, and the sky more pink?"></textarea></div>
        <button class="btn btn-primary" type="submit">Send to June</button></form>`,
      onOpen: (body, close) => {
        const f = body.querySelector('form');
        f.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (!validateForm(f)) return;
          await busy(f.querySelector('button'), async () => {
            try {
              const result = await post(`/orders/${encodeURIComponent(number)}/changes${qs}`, { message: f.message.value.trim() });
              close();
              toast('Sent. June will update the sketch and email you.');
              render(result.order);
            } catch (error) { handleFormError(f, error); }
          });
        });
      },
    });
  });

  const reviewForm = $('[data-review-form]');
  reviewForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(reviewForm)) return;
    await busy(reviewForm.querySelector('button[type="submit"]'), async () => {
      try {
        let photo = '';
        const file = $('#rvPhoto').files[0];
        if (file) photo = await uploadImage(file, 'reviews');
        await post(`/orders/${encodeURIComponent(number)}/review${qs}`, {
          rating: Number(reviewForm.querySelector('input[name="rating"]:checked')?.value || 5),
          text: reviewForm.text.value.trim(),
          city: reviewForm.city.value.trim(),
          photo,
        });
        reviewForm.innerHTML = '<p class="quote-note">Thank you. That genuinely made June’s day.</p>';
      } catch (error) { handleFormError(reviewForm, error); }
    });
  });

  if (location.hash === '#review' || location.hash === '#sketch') $(location.hash)?.scrollIntoView({ behavior: 'smooth' });
}

async function load() {
  try {
    const { order: o } = await get(`/orders/${encodeURIComponent(number)}${qs}`);
    render(o);
  } catch (error) {
    root.innerHTML = `${emptyState({ title: 'We couldn’t open that order.', body: error.message, cta: 'Track with your email', href: '/track' })}`;
  }
}

load();
