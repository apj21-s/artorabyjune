const crypto = require('crypto');
const { Order, CartDraft, nextSequence } = require('../models');
const money = require('./money');
const { randomToken } = require('./util');
const { buildTimeline, flowFor, STAGES } = require('./stages');
const email = require('../services/email');

async function nextOrderNumber() {
  const seq = await nextSequence('order');
  return `AJ-${String(seq).padStart(4, '0')}`;
}

function pushHistory(order, status, note) {
  order.history.push({ status, note: note || STAGES[status]?.note || '', at: new Date() });
}

async function newOrder(fields) {
  const order = new Order({
    ...fields,
    number: await nextOrderNumber(),
    accessToken: randomToken(18),
    status: 'received',
  });
  pushHistory(order, 'received');
  return order;
}

// ART-XXXX-XXXX, without look-alike characters.
function giftCardCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `ART-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

async function markDraftsPlaced(emailAddr) {
  if (emailAddr) await CartDraft.updateMany({ email: String(emailAddr).toLowerCase(), orderPlacedAt: { $exists: false } }, { $set: { orderPlacedAt: new Date() } });
}

async function setStatus(order, status, { note = '', notify = true } = {}) {
  if (!STAGES[status]) throw Object.assign(new Error('Unknown status.'), { status: 400, expose: true });
  if (status !== 'cancelled' && !flowFor(order.type).includes(status)) {
    throw Object.assign(new Error('That stage doesn’t apply to this order type.'), { status: 400, expose: true });
  }
  if (order.status === status && !note) return order;
  if (status === 'cancelled' && order.status !== 'cancelled') {
    // Close any payment proof still waiting, and free its UTR. (Required lazily: payments.js uses this file.)
    // Those changes are atomic updates in the database; the save below only $sets the status and
    // $pushes one history entry, so it doesn't overwrite them.
    await require('./payments').closeOpenProofs(order._id, 'cancelled');
  }
  order.status = status;
  pushHistory(order, status, note);
  await order.save();
  if (notify) {
    const t = email.templates.stageUpdate(order, note);
    // Keyed by history position: a repeated save sends once, a new note on the same stage still sends.
    await email.send({ to: order.email, ...t, key: `stage:${order._id}:${order.history.length}`, kind: 'stage' });
    if (status === 'delivered' && !order.reviewRequestedAt) {
      order.reviewRequestedAt = new Date();
      await order.save();
      await email.send({ to: order.email, ...email.templates.reviewRequest(order), key: `review-request:${order._id}`, kind: 'review-request' });
    }
  }
  return order;
}

// What a customer is allowed to see about their order.
function customerView(order) {
  const o = order.toObject ? order.toObject({ virtuals: true }) : order;
  const balanceDue = Math.max(0, (o.total || 0) - (o.amountPaid || 0));
  const c = o.commission || {};
  const due = money.amountDue(o);
  const pending = money.openPayment(o);
  const byTime = (a, b) => new Date(b.reviewedAt || b.at || 0) - new Date(a.reviewedAt || a.at || 0);
  const rejected = (o.payments || []).filter((p) => p.status === 'rejected').sort(byTime)[0];
  const lastPaid = (o.payments || []).filter((p) => p.status === 'paid').sort(byTime)[0];
  return {
    number: o.number,
    type: o.type,
    status: o.status,
    statusLabel: STAGES[o.status]?.label || o.status,
    createdAt: o.createdAt,
    name: o.name,
    email: o.email,
    items: o.items || [],
    commission: o.type === 'commission' ? {
      tier: c.tier,
      tierTitle: c.tierTitle,
      style: c.style,
      baseColour: c.baseColour,
      occasion: c.occasion,
      story: c.story,
      include: c.include,
      moods: c.moods || [],
      references: c.references || [],
      deadline: c.deadline,
      quoteMessage: c.quoteMessage || '',
      sketchImage: c.sketchImage || '',
      quotedAt: c.quotedAt,
      approvedAt: c.approvedAt,
      changeRequests: c.changeRequests || [],
    } : undefined,
    gift: o.gift || {},
    shippingAddress: o.shippingAddress || {},
    couponCode: o.couponCode || '',
    bundleDiscount: o.bundleDiscount || 0,
    giftCardCode: o.giftCardCode || '',
    giftCardAmount: o.giftCardAmount || 0,
    subtotal: o.subtotal,
    discount: o.discount,
    shippingFee: o.shippingFee,
    giftWrapFee: o.giftWrapFee,
    total: o.total,
    depositAmount: o.depositAmount,
    amountPaid: o.amountPaid,
    balanceDue,
    paymentStatus: o.paymentStatus,
    tracking: o.tracking || {},
    timeline: withPaymentStep(buildTimeline(o), pending),
    due,
    pendingPayment: pending ? {
      kind: pending.kind,
      amount: pending.expectedAmount,
      utrEnd: (pending.utr || '').slice(-4),
      submittedAt: pending.submittedAt,
    } : null,
    lastRejection: !pending && rejected && (!lastPaid || rejected.reviewedAt > lastPaid.at) ? { reason: rejected.rejectionReason, at: rejected.reviewedAt, kind: rejected.kind } : null,
    canApprove: o.type === 'commission' && o.status === 'quoted' && !c.approvedAt && (o.amountPaid || 0) === 0,
    canPay: Boolean(due) && !pending,
    canPayDeposit: Boolean(due && due.kind === 'deposit') && !pending,
    canPayBalance: Boolean(due && due.kind === 'balance') && !pending,
    canPayShop: Boolean(due && due.kind === 'full') && !pending,
  };
}

// While a payment is being checked, the customer sees that as its own step in the timeline.
function withPaymentStep(steps, pending) {
  if (!pending) return steps;
  const i = steps.findIndex((s) => s.state === 'current');
  if (i < 0) return steps;
  const out = steps.map((s, n) => (n === i ? { ...s, state: 'done' } : s));
  out.splice(i + 1, 0, {
    key: 'checking',
    label: 'Payment sent, June is checking it',
    note: 'She matches every UPI payment with her bank, usually within a few hours.',
    at: pending.submittedAt,
    state: 'current',
  });
  return out;
}

module.exports = { newOrder, nextOrderNumber, setStatus, customerView, pushHistory, markDraftsPlaced, giftCardCode };
