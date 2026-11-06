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

// ---------- Transport ----------
let transport = null; // reused across warm serverless invocations (one login, pooled connection)
let testTransport = null;

function providerName() {
  return testTransport ? 'test' : config.emailProvider;
}

function fromAddress() {
  const e = config.email;
  const name = e.fromName.replace(/"/g, '');
  if (config.emailProvider === 'resend') return config.resend.from;
  if (config.emailProvider === 'smtp') return e.from || `"${name}" <${e.smtpUser}>`;
  return `"${name}" <${e.gmailUser || 'studio@example.com'}>`;
}

async function getTransport() {
  if (testTransport) return testTransport;
  if (transport) return transport;
  const e = config.email;
  if (config.emailProvider === 'resend') {
    transport = {
      async sendMail(msg) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, reply_to: msg.replyTo, headers: msg.headers }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message || 'send failed'}`);
        return { messageId: body.id };
      },
    };
    return transport;
  }
  const nodemailer = require('nodemailer');
  const smtp = config.emailProvider === 'smtp';
  const host = smtp ? e.smtpHost : 'smtp.gmail.com';
  const auth = smtp ? { user: e.smtpUser, pass: e.smtpPass } : { user: e.gmailUser, pass: e.gmailPass };
  // Connect over IPv4: some hosts have no IPv6 route, and nodemailer may pick IPv6 first.
  const ip = await new Promise((resolve) => {
    require('dns').lookup(host, { family: 4 }, (err, address) => resolve(err ? host : address));
  });
  transport = nodemailer.createTransport({
    host: ip,
    port: smtp ? e.smtpPort : 465,
    secure: smtp ? e.smtpPort === 465 : true,
    tls: { servername: host },
    auth,
    pool: true,
    maxConnections: 2,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

// Plain-text copy of an HTML email: better delivery, and readable on any client.
function htmlToText(html = '') {
  return String(html)
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<span style="display:none[\s\S]*?<\/span>/i, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && !href.startsWith('mailto:') && text !== href ? `${text} (${href})` : text || href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|div|tr|table)>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortError(error) {
  return String(error?.message || error || 'unknown error').replace(config.email.gmailPass || '\u0000', '***').slice(0, 300);
}

// ---------- Outbox ----------
function EmailLog() {
  return require('../models').EmailLog;
}

// The logo and hills travel inside the email (inline images), so they show even when
// a mail app blocks remote images, and always match the current files.
const INLINE = ['mark.png', 'hills.png'];
const inlineCache = {};
function withInlineImages(html = '') {
  const attachments = [];
  let out = html;
  for (const name of INLINE) {
    const url = `${config.appUrl}/assets/email/${name}`;
    if (!out.includes(url)) continue;
    try {
      inlineCache[name] ||= require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public', 'assets', 'email', name));
    } catch { continue; } // file missing: keep the remote link
    const cid = `${name.replace('.png', '')}@artora`;
    out = out.split(url).join(`cid:${cid}`);
    attachments.push({ filename: name, content: inlineCache[name], cid, contentDisposition: 'inline' });
  }
  return { html: out, attachments };
}

async function deliver(log) {
  log.status = 'sending';
  log.attempts += 1;
  log.provider = providerName();
  await log.save();
  try {
    const inline = config.emailProvider === 'resend' ? { html: log.html, attachments: [] } : withInlineImages(log.html);
    const info = await (await getTransport()).sendMail({
      from: fromAddress(),
      to: log.to,
      replyTo: log.replyTo || undefined,
      subject: log.subject,
      html: inline.html,
      text: log.text,
      headers: log.headers || undefined,
      attachments: inline.attachments.length ? inline.attachments : undefined,
    });
    log.status = 'sent';
    log.messageId = info?.messageId || '';
    log.sentAt = new Date();
    log.lastError = undefined;
    if (['password-reset', 'verify-email'].includes(log.kind)) { log.html = undefined; log.text = undefined; }
    await log.save();
    return { ok: true, id: log._id };
  } catch (error) {
    // Email problems must never break an order or a form.
    log.status = 'failed';
    log.lastError = shortError(error);
    await log.save().catch(() => {});
    if (!config.isTest) console.error(`[email] failed to=${log.to} subject="${log.subject}": ${log.lastError}`);
    if (/Invalid login|Username and Password not accepted|EAUTH|ECONNECTION|ETIMEDOUT|ESOCKET|ENETUNREACH/i.test(log.lastError)) transport = null;
    return { ok: false, id: log._id, error: log.lastError };
  }
}

/**
 * Send one email through the outbox.
 * key:   idempotency key; the same key never sends twice (a failed one may be retried).
 * defer: just queue it; the cron (or the next retry) sends it. Used for bulk sends.
 */
async function send({ to, subject, html, text, replyTo, key, kind = '', headers, defer = false }) {
  if (!to) return { skipped: true };
  const doc = {
    key: key || undefined,
    kind,
    to: String(to).trim(),
    replyTo: replyTo || config.brand.supportEmail || undefined,
    subject,
    html,
    text: text || htmlToText(html),
    headers,
    status: providerName() ? 'queued' : 'skipped',
  };
  let log;
  try {
    log = await EmailLog().create(doc);
  } catch (error) {
    if (error?.code === 11000 && key) {
      const existing = await EmailLog().findOne({ key });
      if (!existing || existing.status !== 'failed' || !providerName()) return { duplicate: true };
      return deliver(existing);
    }
    // The database is down: still try to send, without a log row.
    if (!providerName()) return { skipped: true };
    try {
      await (await getTransport()).sendMail({ from: fromAddress(), ...doc });
      return { ok: true };
    } catch (sendError) {
      console.error('[email] send error', shortError(sendError));
      return { ok: false };
    }
  }
  if (!providerName()) {
    if (!config.isTest) console.log(`[email] (not sent, no email provider set) to=${doc.to} subject="${subject}"`);
    return { skipped: true, id: log._id };
  }
  if (defer) return { queued: true, id: log._id };
  return deliver(log);
}

// Retries failed emails and sends queued ones. Called by the daily cron and from admin.
async function processOutbox({ limit = 100, deadline = Date.now() + 45_000 } = {}) {
  if (!providerName()) return { sent: 0, failed: 0, left: 0 };
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = await EmailLog().find({
    createdAt: { $gte: since },
    $or: [{ status: 'queued' }, { status: 'failed', attempts: { $lt: 3 } }],
  }).sort({ createdAt: 1 }).limit(limit);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    const r = await deliver(row);
    if (r.ok) sent += 1; else failed += 1;
  }
  return { sent, failed, left: rows.length - sent - failed };
}

async function retry(id) {
  const row = await EmailLog().findById(id);
  if (!row) return null;
  if (row.status === 'sent') return { ok: true, already: true };
  if (!providerName()) return { ok: false, error: 'No email provider is set up yet.' };
  return deliver(row);
}

// Checks the login without sending anything (used by the admin test button).
async function verify() {
  if (!providerName()) return { ok: false, error: 'No email provider is set up yet.' };
  const t = await getTransport();
  if (typeof t.verify !== 'function') return { ok: true };
  try {
    await t.verify();
    return { ok: true };
  } catch (error) {
    transport = null;
    return { ok: false, error: shortError(error) };
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
  // To the studio inbox. Reply-To is the customer, so pressing Reply in Gmail answers them.
  enquiryForOwner(m) {
    const row = (label, value) => (value ? `<tr><td style="padding:8px 14px 8px 0;border-top:1px solid rgba(34,29,25,.08);font-size:13px;color:${C.soft};white-space:nowrap;vertical-align:top">${label}</td><td style="padding:8px 0;border-top:1px solid rgba(34,29,25,.08);font-size:15px;color:${C.ink}">${value}</td></tr>` : '');
    const mail = escapeHtml(m.email);
    const tel = m.phone ? `<a href="tel:${escapeHtml(m.phone.replace(/[^\d+]/g, ''))}" style="color:${C.ink}">${escapeHtml(m.phone)}</a>` : '';
    const when = new Date(m.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const replyHref = `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.topic || 'your message'} · Artora by June`)}`;
    return {
      subject: `New enquiry · ${m.topic || 'General'} · ${m.name}`,
      html: layout({
        preheader: String(m.message || '').slice(0, 110),
        title: `${m.name} wrote to the studio.`,
        rawHtml: `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px">
          ${row('Name', escapeHtml(m.name))}
          ${row('Email', `<a href="mailto:${mail}" style="color:${C.ink}">${mail}</a>`)}
          ${row('Phone', tel)}
          ${row('About', escapeHtml(m.topic || 'General'))}
          ${row('Sent', escapeHtml(`${when} IST`))}
        </table>
        <div style="border-left:3px solid ${C.cherry};padding:4px 0 4px 16px;margin:0 0 6px;font-size:15px;line-height:1.7;color:${C.ink};white-space:pre-wrap">${escapeHtml(m.message)}</div>
        <p style="margin:16px 0 0;font-size:13px;color:${C.soft}">Just press Reply: your answer goes straight to ${mail}.</p>`,
        cta: { href: replyHref, label: `Reply to ${String(m.name).split(' ')[0]}` },
      }),
    };
  },
  enquiryReceived(m) {
    return {
      subject: 'June has your note · Artora by June',
      html: layout({
        preheader: 'Thank you for writing. Here is a copy of your message.',
        title: 'Your note is with June.',
        lines: [
          `Hi ${String(m.name).split(' ')[0] || 'there'}, thank you for writing to the studio.`,
          `${m.replyTime || 'June usually replies within a day.'} If you need to add anything, just reply to this email.`,
        ],
        rawHtml: `<p style="margin:6px 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${C.soft}">Your message · ${escapeHtml(m.topic || 'General')}</p>
          <div style="border-left:3px solid #CDBFA4;padding:4px 0 4px 16px;font-size:15px;line-height:1.7;color:${C.ink};white-space:pre-wrap">${escapeHtml(m.message)}</div>`,
        cta: { href: `${config.appUrl}/shop`, label: 'Browse the studio' },
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

function adminInbox() {
  return config.adminNotifyEmail || config.email.gmailUser || config.initialAdminEmails[0] || '';
}

async function notifyAdmin(subject, lines, path = '/admin', { key, replyTo } = {}) {
  const to = adminInbox();
  if (!to) return { skipped: true };
  const t = templates.adminAlert(subject, lines, `${config.appUrl}${path}`);
  return send({ to, ...t, key, replyTo, kind: 'admin' });
}

module.exports = {
  send, templates, notifyAdmin, orderLink, layout, htmlToText, processOutbox, retry, verify, adminInbox, providerName,
  _setTestTransport(t) { testTransport = t; transport = null; },
};
