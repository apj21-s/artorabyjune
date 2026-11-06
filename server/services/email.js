const config = require('../config');
const { escapeHtml, inr } = require('../lib/util');
const { stageLabel } = require('../lib/stages');

const C = {
  canvas: '#E8E1D0',
  paper: '#FBF8F1',
  ink: '#221D19',
  soft: '#56493d',
  cherry: '#C1443C',
  blue: '#3A4CA6',
};

function button(href, label) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${C.ink};color:${C.paper};text-decoration:none;padding:13px 24px;border-radius:999px;font-weight:600;font-size:15px">${escapeHtml(label)}</a>`;
}

// Every value passed into `lines` is escaped. Use `rawHtml` only for markup built here.
function layout({ preheader = '', title, lines = [], rawHtml = '', cta }) {
  const body = lines.map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${C.soft}">${escapeHtml(l)}</p>`).join('');
  const asset = (p) => `${config.appUrl}${p}`;
  // Same look as the site: canvas colour, a paper card with stitched edge, painted hills at the foot.
  return `<!doctype html><html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;background:#ECE4D2;font-family:Inter,Helvetica,Arial,sans-serif;color:${C.ink}">
<span style="display:none;opacity:0;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
<div style="padding:32px 14px 0;background:#ECE4D2">
  <div style="max-width:600px;margin:0 auto">
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
      <td style="vertical-align:middle;padding-right:10px"><img src="${asset('/assets/email/mark.png')}" width="36" height="36" alt="" style="display:block;border-radius:9px"></td>
      <td style="vertical-align:middle;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;font-weight:700;font-size:19px;color:${C.ink}">Artora <span style="font-family:'Caveat',cursive;font-weight:700;font-size:21px">by June</span></td>
    </tr></table>
    <div style="background:${C.paper};border-radius:6px;padding:7px;box-shadow:0 14px 30px -18px rgba(59,47,34,.5)">
      <div style="border:1.5px dashed #CDBFA4;border-radius:3px;padding:30px 26px 28px">
        <h1 style="margin:0 0 16px;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;color:${C.ink}">${escapeHtml(title)}</h1>
        ${body}
        ${rawHtml}
        ${cta ? `<div style="margin-top:22px">${button(cta.href, cta.label)}</div>` : ''}
        <p style="margin:26px 0 0;font-family:'Caveat',Georgia,cursive;font-size:22px;color:${C.cherry}">— June</p>
      </div>
    </div>
    <p style="margin:20px 0 14px;font-size:12px;color:${C.soft};text-align:center">Hand-painted, one canvas at a time · <a href="${config.appUrl}" style="color:${C.soft}">${config.appUrl.replace(/^https?:\/\//, '')}</a></p>
  </div>
</div>
<img src="${asset('/assets/email/hills.png')}" width="600" height="60" alt="" style="display:block;width:100%;max-width:100%;height:60px;object-fit:cover;border:0">
</body></html>`;
}

function orderSummaryHtml(order) {
  const rows = [];
  if (order.type === 'shop') {
    order.items.forEach((i) => rows.push([`${i.title} × ${i.qty}`, inr(i.price * i.qty)]));
  } else if (order.subtotal) {
    rows.push([order.commission?.tierTitle || 'Custom commission', inr(order.subtotal)]);
  }
  if (order.discount) rows.push([`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`, `−${inr(order.discount)}`]);
  if (order.giftWrapFee) rows.push(['Gift wrap', inr(order.giftWrapFee)]);
  if (order.type === 'shop') rows.push(['Shipping', order.shippingFee ? inr(order.shippingFee) : 'Free']);
  if (order.total) rows.push(['<strong>Total</strong>', `<strong>${inr(order.total)}</strong>`]);
  if (!rows.length) return '';
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 6px;font-size:14px">${rows.map(([a, b]) => `
    <tr><td style="padding:8px 0;border-top:1px solid rgba(34,29,25,.08)">${a.startsWith('<strong>') ? a : escapeHtml(a)}</td><td style="padding:8px 0;border-top:1px solid rgba(34,29,25,.08);text-align:right">${b.startsWith('<strong>') ? b : escapeHtml(b)}</td></tr>`).join('')}</table>`;
}

function orderLink(order) {
  return `${config.appUrl}/order/${encodeURIComponent(order.number)}?t=${encodeURIComponent(order.accessToken)}`;
}

async function send({ to, subject, html, replyTo }) {
  if (!to) return { skipped: true };
  if (!config.features.email) {
    if (!config.isTest) console.log(`[email] (not sent — RESEND_API_KEY missing) to=${to} subject="${subject}"`);
    return { skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.resend.from, to, subject, html, reply_to: replyTo || config.brand.supportEmail }),
    });
    if (!res.ok) console.error('[email] send failed', res.status, await res.text().catch(() => ''));
    return { ok: res.ok };
  } catch (error) {
    // Email problems must never break an order.
    console.error('[email] send error', error.message);
    return { ok: false };
  }
}

const templates = {
  commissionReceived(order) {
    return {
      subject: `June has your story · ${order.number}`,
      html: layout({
        preheader: 'Your note is safely in the studio.',
        title: 'June has received your story.',
        lines: [
          `Hi ${order.name || 'there'}, thank you for trusting June with this memory.`,
          'Next, June will reply with a quote and a quick sketch — usually within a day. Nothing is charged until you approve it.',
          `Your order number is ${order.number}.`,
        ],
        cta: { href: orderLink(order), label: 'View your story' },
      }),
    };
  },
  quoteReady(order) {
    return {
      subject: `Your sketch and quote are ready · ${order.number}`,
      html: layout({
        preheader: 'Approve it to begin painting.',
        title: 'Your sketch is ready.',
        lines: [
          `Hi ${order.name || 'there'}, June has sketched your story.`,
          order.commission?.quoteMessage || '',
          `Total: ${inr(order.total)}. A deposit of ${inr(order.depositAmount)} starts the painting; the balance is due before it ships.`,
        ].filter(Boolean),
        rawHtml: order.commission?.sketchImage ? `<img src="${escapeHtml(order.commission.sketchImage)}" alt="Sketch preview" style="width:100%;border-radius:14px;margin:6px 0 4px">` : '',
        cta: { href: orderLink(order), label: 'Review & approve' },
      }),
    };
  },
  paymentReceived(order, payment) {
    const kindLabel = { deposit: 'Deposit', balance: 'Balance', full: 'Payment' }[payment.kind] || 'Payment';
    return {
      subject: `${kindLabel} received · ${order.number}`,
      html: layout({
        preheader: `${inr(payment.amount)} received with thanks.`,
        title: `${kindLabel} received — thank you.`,
        lines: [
          `We received ${inr(payment.amount)} for order ${order.number}.`,
          order.type === 'commission' && payment.kind === 'deposit' ? 'June will begin painting your memory now. You’ll get an update at every stage.' : '',
          order.type === 'shop' ? 'June will pack your tote with care and send tracking details once it ships.' : '',
          order.balanceDue > 0 ? `Balance remaining: ${inr(order.balanceDue)}.` : '',
        ].filter(Boolean),
        rawHtml: orderSummaryHtml(order),
        cta: { href: orderLink(order), label: 'Track your order' },
      }),
    };
  },
  shopOrderPlaced(order) {
    return {
      subject: `Order confirmed · ${order.number}`,
      html: layout({
        preheader: 'Your tote is reserved.',
        title: 'Your order is confirmed.',
        lines: [`Hi ${order.name || 'there'}, thank you for your order ${order.number}.`],
        rawHtml: orderSummaryHtml(order),
        cta: { href: orderLink(order), label: 'Track your order' },
      }),
    };
  },
  stageUpdate(order, note = '') {
    const lines = [`Hi ${order.name || 'there'}, a little update on ${order.number}.`];
    if (note) lines.push(note);
    if (order.status === 'shipped' && order.tracking?.number) {
      lines.push(`Courier: ${order.tracking.courier || '—'} · Tracking number: ${order.tracking.number}`);
    }
    if (order.status === 'packing' && order.type === 'commission' && order.balanceDue > 0) {
      lines.push(`Your balance of ${inr(order.balanceDue)} is due before it ships — you can pay from your order page.`);
    }
    return {
      subject: `${stageLabel(order.status)} · ${order.number}`,
      html: layout({
        preheader: stageLabel(order.status),
        title: stageLabel(order.status),
        lines,
        cta: order.tracking?.url && order.status === 'shipped'
          ? { href: order.tracking.url, label: 'Track the parcel' }
          : { href: orderLink(order), label: 'See your timeline' },
      }),
    };
  },
  reviewRequest(order) {
    return {
      subject: 'How does your story feel?',
      html: layout({
        preheader: 'Two minutes, and it means the world to a small studio.',
        title: 'Your story has arrived.',
        lines: [
          `Hi ${order.name || 'there'}, we hope it feels like yours.`,
          'If you have a moment, June would love to hear what you think. A photo of it out in the world would make her week.',
        ],
        cta: { href: `${orderLink(order)}#review`, label: 'Leave a few words' },
      }),
    };
  },
  verifyEmail(user, link) {
    return {
      subject: 'Confirm your email for Artora by June',
      html: layout({
        title: 'Confirm your email',
        lines: ['Tap the button to confirm this is your email. Any orders placed with it will then appear in your account.', 'If you didn’t create an account, ignore this email.'],
        cta: { href: link, label: 'Confirm my email' },
      }),
    };
  },
  passwordReset(user, link) {
    return {
      subject: 'Reset your Artora password',
      html: layout({
        title: 'Reset your password',
        lines: ['Someone (hopefully you) asked to reset your password. This link works for 1 hour.', 'If this wasn’t you, ignore this email.'],
        cta: { href: link, label: 'Choose a new password' },
      }),
    };
  },
  restock(email, product) {
    return {
      subject: `Back in the studio: ${product.title}`,
      html: layout({
        title: `${product.title} is back.`,
        lines: ['You asked us to let you know. There are only a few, painted by hand.'],
        cta: { href: `${config.appUrl}/shop/${product.slug}`, label: 'See it now' },
      }),
    };
  },
  giftCardIssued(card) {
    const from = card.recipientEmail !== card.purchaserEmail ? 'Someone thought of you.' : 'Your gift card is ready.';
    const codeBox = `<div style="margin:18px 0;padding:18px;border:2px dashed ${C.cherry};border-radius:14px;text-align:center;background:#fffdf8">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${C.soft}">Artora gift card · ${escapeHtml(inr(card.initialAmount))}</div>
      <div style="margin-top:8px;font-family:'Courier New',monospace;font-size:24px;font-weight:700;letter-spacing:.12em;color:${C.ink}">${escapeHtml(card.code)}</div>
      <div style="margin-top:8px;font-size:12px;color:${C.soft}">Valid until ${escapeHtml(new Date(card.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>`;
    const note = card.message ? `<p style="margin:0 0 14px;font-family:Georgia,serif;font-style:italic;font-size:17px;line-height:1.6;color:${C.ink}">“${escapeHtml(card.message)}”</p>` : '';
    return {
      subject: `An Artora gift card for you (${inr(card.initialAmount)})`,
      html: layout({
        preheader: `Your code: ${card.code}`,
        title: from,
        lines: ['Use the code at checkout on a ready-made tote, or for a commission — June will take it off your quote.'],
        rawHtml: note + codeBox,
        cta: { href: `${config.appUrl}/shop`, label: 'Browse the studio' },
      }),
    };
  },
  giftCardSent(card, order) {
    return {
      subject: `Your gift card is on its way to ${card.recipientName || card.recipientEmail}`,
      html: layout({
        title: 'Sent with love.',
        lines: [`We’ve emailed a ${inr(card.initialAmount)} gift card to ${card.recipientEmail}.`, `Order ${order.number}. Keep this email in case they need the code again: ${card.code}.`],
      }),
    };
  },
  cartReminder(draft, lines) {
    const rows = lines.map((l) => `<tr><td style="padding:6px 0;font-size:15px;color:${C.ink}">${escapeHtml(l.title)}</td><td style="padding:6px 0;text-align:right;font-size:15px;color:${C.ink}">${escapeHtml(inr(l.price))}</td></tr>`).join('');
    return {
      subject: 'Your tote is still waiting in the studio',
      html: layout({
        preheader: 'Painted by hand, one of a kind — they don’t stay long.',
        title: 'You left something in your bag.',
        lines: ['Every tote is one of a kind, so we can’t hold it for long. If it’s still the one, it’s right where you left it.'],
        rawHtml: `<table role="presentation" width="100%" style="border-collapse:collapse;margin:6px 0 14px;border-top:1px dashed #cdbfa4;border-bottom:1px dashed #cdbfa4">${rows}</table>
          <p style="margin:18px 0 0;font-size:12px;color:${C.soft}">Not interested? <a href="${escapeHtml(`${config.appUrl}/api/cart/unsubscribe/${draft.token}`)}" style="color:${C.soft}">Don’t remind me again</a>.</p>`,
        cta: { href: `${config.appUrl}/checkout?restore=${encodeURIComponent(draft.token)}`, label: 'Back to my bag' },
      }),
    };
  },
  adminAlert(subject, lines, href) {
    return {
      subject: `[Studio] ${subject}`,
      html: layout({ title: subject, lines, cta: href ? { href, label: 'Open in admin' } : undefined }),
    };
  },
};

async function notifyAdmin(subject, lines, path = '/admin') {
  const to = config.adminNotifyEmail || config.initialAdminEmails[0];
  if (!to) return;
  const t = templates.adminAlert(subject, lines, `${config.appUrl}${path}`);
  await send({ to, ...t });
}

module.exports = { send, templates, notifyAdmin, orderLink, layout };
