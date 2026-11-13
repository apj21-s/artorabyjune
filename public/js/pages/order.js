import { $, html, raw, inr, fmtDate } from '../core/dom.js';
import { get, post } from '../core/api.js';
import { initLayout } from '../core/layout.js';
import { toast, toastError, busy, openModal, validateForm, handleFormError } from '../core/ui.js';
import { renderUpiPanel } from '../core/upi-pay.js';
import { timeline, paymentChip, emptyState } from '../core/components.js';
import { uploadImage } from '../core/upload.js';

initLayout();

const number = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const root = $('[data-order-view]');
let order;
let payment = null;

const qs = token ? `?t=${encodeURIComponent(token)}` : '';

function moneyRows(o) {
  const rows = [];
  if (o.type === 'shop') o.items.forEach((i) => rows.push([`${i.title} × ${i.qty}`, inr(i.price * i.qty)]));
  else if (o.status !== 'received' || o.total) rows.push([o.commission?.tierTitle || 'Commission', inr(o.subtotal)]);
  if (o.bundleDiscount) rows.push(['Bundle saving', `−${inr(o.bundleDiscount)}`]);
  if (o.discount) rows.push([`Coupon ${o.couponCode}`, `−${inr(o.discount)}`]);
  if (o.giftWrapFee) rows.push(['Gift wrap', inr(o.giftWrapFee)]);
  if (o.type === 'shop') rows.push(['Shipping', o.shippingFee ? inr(o.shippingFee) : 'Free']);
  if (o.giftCardAmount) rows.push([`Gift card ${o.giftCardCode}`, `−${inr(o.giftCardAmount)}`]);
  if (o.total) rows.push(['Total', inr(o.total)]);
  if (o.amountPaid) rows.push(['Paid', inr(o.amountPaid)]);
  if (o.balanceDue && o.total) rows.push(['Balance due', inr(o.balanceDue)]);
  return rows;
}

// A clean A4 receipt for printing or saving as PDF, built only when asked for. On screen it's never shown;
// when printing, it's the only thing on the page (see .print-receipt in canvas.css).
const PAY_LABEL = {
  paid: 'Paid in full',
  overpaid: 'Paid in full',
  deposit_paid: 'Deposit paid',
  partially_paid: 'Part paid',
  unpaid: 'Not paid yet',
  refunded: 'Refunded',
};

function printReceipt(o) {
  const settled = ['paid', 'overpaid'].includes(o.paymentStatus);
  const payLabel = o.pendingPayment ? 'Payment being checked by June' : (PAY_LABEL[o.paymentStatus] || o.paymentStatus);
  const a = o.shippingAddress || {};
  const address = [a.name, a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), a.pincode, a.phone].filter(Boolean);
  const rows = moneyRows(o);
  const el = document.createElement('div');
  el.className = 'print-receipt';
  el.innerHTML = html`
    <div class="pr-head">
      <div><p class="pr-brand">Artora by June</p><p class="pr-sub">Hand-painted totes</p></div>
      <div class="pr-title"><p>${settled ? 'Receipt' : 'Order summary'}</p><p class="pr-no">${o.number}</p></div>
    </div>
    <dl class="pr-meta">
      <div><dt>Placed</dt><dd>${fmtDate(o.createdAt)}</dd></div>
      <div><dt>Customer</dt><dd>${o.name}${o.email ? raw(html`<br>${o.email}`) : ''}</dd></div>
      ${address.length ? raw(html`<div><dt>Ships to</dt><dd>${raw(address.map((l) => html`${l}`).join('<br>'))}</dd></div>`) : ''}
      <div><dt>Payment</dt><dd>${payLabel}${o.pendingPayment ? raw(html`<br>UPI, UTR ending ${o.pendingPayment.utrEnd}`) : ''}</dd></div>
    </dl>
    <table class="pr-lines">
      <tbody>${raw(rows.map(([k, v]) => html`<tr class="${k === 'Total' ? 'is-total' : ''}"><th scope="row">${k}</th><td>${v}</td></tr>`).join(''))}</tbody>
    </table>
    ${settled ? '' : raw('<p class="pr-note">This is not a payment receipt yet. It becomes one once June confirms your payment.</p>')}
    <p class="pr-foot">Thank you for supporting handmade. Questions? Write to June and mention ${o.number}.<br>${location.origin}/order/${o.number}</p>`;
  return el;
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
              <button class="btn btn-primary" type="button" data-approve>Approve the sketch</button>
              <p class="helper-note">Then pay the ${inr(o.depositAmount)} deposit by UPI.</p>
              <button class="btn-text" type="button" data-changes>or ask June for changes</button>`) : ''}
          </div>
        </div>
      </div>
    </section>`;
}

// Payment state, in the order a customer meets it: being checked, not matched, something due.
function payHeading(o) {
  const due = o.due;
  if (!due) return '';
  if (o.amountPaid > 0 && due.kind === 'full') return `${inr(due.amount)} is still to pay.`;
  if (due.kind === 'deposit') return o.amountPaid > 0 ? `${inr(due.amount)} of the deposit is still to pay.` : `Pay the ${inr(due.amount)} deposit and June begins.`;
  if (due.kind === 'balance') return 'Your story is nearly ready to travel. Pay the balance.';
  return `Pay ${inr(due.amount)} to confirm your order.`;
}

function paymentSection(o) {
  if (o.pendingPayment) {
    const p = o.pendingPayment;
    return html`
      <section class="o-section o-checking" id="payment">
        <h2>June is checking your payment.</h2>
        <p class="checking-note">${inr(p.amount)} · UTR ending <strong>${p.utrEnd}</strong> · sent ${fmtDate(p.submittedAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
        <p class="mail-hint">She matches every UPI payment with her bank by hand, usually within a few hours, and emails you when it’s confirmed. Nothing else to do for now.</p>
      </section>`;
  }
  if (!o.canPay) return '';
  return html`
    <section class="o-section" id="payment">
      ${o.lastRejection ? raw(html`
        <div class="rejection-note">
          <h2>June couldn’t match your payment yet.</h2>
          <p class="quote-note">“${o.lastRejection.reason}” <span class="accent">— June</span></p>
          <p class="helper-note">Your order is still saved. Send a clearer screenshot or the right UTR below. If money left your account, <a href="/contact">write to June</a> and she’ll sort it out.</p>
        </div>`) : ''}
      <div data-upi-panel></div>
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
    ${welcome ? raw(html`<p class="mail-hint">A confirmation is on its way to <strong>${o.email || 'your email'}</strong>. Don’t see it in a few minutes? Check your spam or promotions folder and mark it “Not spam”, so updates about your tote reach your inbox.</p>`) : ''}
    <div class="order-grid">
      ${raw(quoteSection(o))}
      ${raw(paymentSection(o))}
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
          <button class="btn-text receipt-save" type="button" data-print>Save receipt (PDF)</button>
        </section>`) : ''}
      <p class="helper-note center">Questions? <a href="/contact">Write to June</a> and mention ${o.number}. <a href="/account">Sign in</a> to see all your orders in one place.</p>
    </div>`;
  wire();
}

function wire() {
  const panel = $('[data-upi-panel]');
  if (panel && payment) {
    renderUpiPanel(panel, {
      payment,
      number: order.number,
      token,
      heading: payHeading(order),
      onSubmitted: (o) => {
        payment = null;
        toast('Sent. June will check it and email you.');
        render(o);
        $('#payment')?.scrollIntoView({ behavior: 'smooth' });
      },
    });
  }

  $('[data-approve]')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      const couponCode = $('#apCoupon')?.value.trim() || '';
      const result = await post(`/orders/${encodeURIComponent(number)}/approve${qs}`, { couponCode });
      if (result.order.depositAmount !== order.depositAmount) toast(`Coupon applied. New deposit: ${inr(result.order.depositAmount)}.`);
      payment = result.payment;
      render(result.order);
      $('#payment')?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) { toastError(error); }
  }));

  $('[data-print]')?.addEventListener('click', () => {
    document.querySelector('.print-receipt')?.remove();
    const sheet = printReceipt(order);
    document.body.append(sheet);
    const title = document.title;
    document.title = `Artora by June ${order.number}`; // becomes the PDF's file name
    window.addEventListener('afterprint', () => { sheet.remove(); document.title = title; }, { once: true });
    window.print();
  });

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

  if (['#review', '#sketch', '#payment'].includes(location.hash)) $(location.hash)?.scrollIntoView({ behavior: 'smooth' });
}

async function load() {
  try {
    const res = await get(`/orders/${encodeURIComponent(number)}${qs}`);
    payment = res.payment;
    render(res.order);
  } catch (error) {
    root.innerHTML = `${emptyState({ title: 'We couldn’t open that order.', body: error.message, cta: 'Track with your email', href: '/track' })}`;
  }
}

load();
