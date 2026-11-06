const crypto = require('crypto');
const { Order, Product, Coupon, GiftCard, CartDraft, nextSequence } = require('../models');
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

// Reserve stock once an order is paid. Uses a conditional update so stock never goes negative.
// Returns the items that couldn't be reserved (someone else paid for the last one first).
async function commitStock(order) {
  if (order.type !== 'shop' || order.stockCommitted) return [];
  const short = [];
  for (const item of order.items) {
    if (item.kind === 'giftcard') continue;
    const res = await Product.updateOne(
      { _id: item.productId, stock: { $gte: item.qty } },
      { $inc: { stock: -item.qty } },
    );
    if (!res.modifiedCount) short.push(item);
  }
  order.stockCommitted = true;
  if (short.length) {
    const list = short.map((i) => `${i.qty} × ${i.title}`).join(', ');
    order.internalNotes = [order.internalNotes, `OVERSOLD: paid but out of stock — ${list}. Contact the customer (repaint, swap or refund).`].filter(Boolean).join('\n');
  }
  return short;
}

// ART-XXXX-XXXX, without look-alike characters.
function giftCardCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `ART-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

// Takes the gift card amount off its balance. Conditional, so a balance can never go below zero.
async function redeemGiftCard(order) {
  if (!order.giftCardCode || !order.giftCardAmount) return true;
  const res = await GiftCard.updateOne(
    { code: order.giftCardCode, balance: { $gte: order.giftCardAmount } },
    { $inc: { balance: -order.giftCardAmount } },
  );
  if (!res.modifiedCount) {
    order.internalNotes = [order.internalNotes, `GIFT CARD: ${order.giftCardCode} no longer had ₹${order.giftCardAmount} when this was paid. Check before shipping.`].filter(Boolean).join('\n');
    return false;
  }
  return true;
}

// Creates and emails a code for every gift card bought in this order.
async function issueGiftCards(order) {
  if (order.giftCardsIssued) return [];
  const lines = order.items.filter((i) => i.kind === 'giftcard');
  const cards = [];
  for (const line of lines) {
    for (let n = 0; n < line.qty; n += 1) {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      cards.push(await GiftCard.create({
        code: giftCardCode(),
        initialAmount: line.price,
        balance: line.price,
        purchaserEmail: order.email,
        recipientEmail: order.giftCardRecipient?.email || order.email,
        recipientName: order.giftCardRecipient?.name || '',
        message: order.giftCardRecipient?.message || '',
        orderNumber: order.number,
        expiresAt,
      }));
    }
  }
  order.giftCardsIssued = true;
  for (const card of cards) {
    await Promise.all([
      email.send({ to: card.recipientEmail, ...email.templates.giftCardIssued(card, order), key: `giftcard:${card.code}`, kind: 'giftcard' }),
      card.recipientEmail !== order.email
        ? email.send({ to: order.email, ...email.templates.giftCardSent(card, order), key: `giftcard-sent:${card.code}`, kind: 'giftcard' })
        : null,
    ]);
  }
  return cards;
}

// The order is fully covered (e.g. by a gift card): confirm it without a payment step.
async function completeWithoutPayment(order) {
  order.payments.push({ kind: 'full', amount: 0, method: 'giftcard', status: 'paid', note: `Covered by gift card ${order.giftCardCode}` });
  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  pushHistory(order, 'confirmed', 'Paid in full with a gift card.');
  await redeemGiftCard(order);
  await useCoupon(order.couponCode);
  await commitStock(order);
  await order.save();
  const payment = order.payments[order.payments.length - 1];
  await Promise.all([
    email.send({ to: order.email, ...email.templates.paymentReceived(order, payment), key: `payment:${order._id}:${payment._id}`, kind: 'payment' }),
    email.notifyAdmin(`Gift card order ${order.number}`, [`${order.name} paid with ${order.giftCardCode}.`], `/admin#orders/${order._id}`, { key: `admin-payment:${order._id}:${payment._id}`, replyTo: order.email }),
  ]);
  return order;
}

async function markDraftsPlaced(emailAddr) {
  if (emailAddr) await CartDraft.updateMany({ email: String(emailAddr).toLowerCase(), orderPlacedAt: { $exists: false } }, { $set: { orderPlacedAt: new Date() } });
}

async function useCoupon(code) {
  if (code) await Coupon.updateOne({ code }, { $inc: { uses: 1 } });
}

// Records a paid payment exactly once (safe to call from both the browser callback and the webhook).
async function markPaymentPaid(order, { razorpayOrderId, razorpayPaymentId, amount, kind, method = 'razorpay', note }) {
  let payment = razorpayOrderId ? order.payments.find((p) => p.razorpayOrderId === razorpayOrderId) : null;
  if (payment && payment.status === 'paid') return { order, payment, already: true };
  if (!payment) {
    payment = order.payments.create({ kind, amount, method, razorpayOrderId, note, status: 'created' });
    order.payments.push(payment);
    payment = order.payments[order.payments.length - 1];
  }
  payment.status = 'paid';
  payment.razorpayPaymentId = razorpayPaymentId || payment.razorpayPaymentId;
  payment.at = new Date();

  order.amountPaid = order.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0);
  if (order.amountPaid >= order.total && order.total > 0) order.paymentStatus = 'paid';
  else if (order.amountPaid > 0) order.paymentStatus = 'deposit_paid';

  const firstPayment = order.payments.filter((p) => p.status === 'paid').length === 1;
  if (firstPayment) {
    await useCoupon(order.couponCode);
    await redeemGiftCard(order);
    if (['received', 'quoted'].includes(order.status)) {
      if (order.type === 'commission' && !order.commission.approvedAt) order.commission.approvedAt = new Date();
      order.status = 'confirmed';
      pushHistory(order, 'confirmed', payment.kind === 'deposit' ? 'Deposit received. June can begin.' : 'Payment received with thanks.');
    }
  }
  const short = await commitStock(order);
  if (order.paymentStatus === 'paid') await issueGiftCards(order);
  await order.save();

  const t = email.templates.paymentReceived(order, payment);
  await Promise.all([
    email.send({ to: order.email, ...t, key: `payment:${order._id}:${payment._id}`, kind: 'payment' }),
    email.notifyAdmin(`${payment.kind} payment · ${order.number}`, [`₹${payment.amount} received from ${order.name} (${order.email}).`], `/admin#orders/${order._id}`, { key: `admin-payment:${order._id}:${payment._id}`, replyTo: order.email }),
  ]);
  if (short.length) {
    await email.notifyAdmin(`Action needed: ${order.number} was paid but is out of stock`, [
      `Someone else bought the last one first: ${short.map((i) => `${i.qty} × ${i.title}`).join(', ')}.`,
      'Reach out to the customer to offer a repaint, a swap or a refund.',
    ], `/admin#orders/${order._id}`, { key: `admin-short:${order._id}:${payment._id}`, replyTo: order.email });
  }
  return { order, payment, already: false };
}

async function setStatus(order, status, { note = '', notify = true } = {}) {
  if (!STAGES[status]) throw Object.assign(new Error('Unknown status.'), { status: 400, expose: true });
  if (status !== 'cancelled' && !flowFor(order.type).includes(status)) {
    throw Object.assign(new Error('That stage doesn’t apply to this order type.'), { status: 400, expose: true });
  }
  if (order.status === status && !note) return order;
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
    timeline: buildTimeline(o),
    canApprove: o.type === 'commission' && o.status === 'quoted' && (o.amountPaid || 0) === 0,
    canPayBalance: o.type === 'commission' && o.paymentStatus === 'deposit_paid' && balanceDue > 0 && !['cancelled', 'delivered'].includes(o.status),
    canPayShop: o.type === 'shop' && o.paymentStatus === 'unpaid' && o.status === 'received',
  };
}

module.exports = { newOrder, nextOrderNumber, markPaymentPaid, setStatus, customerView, commitStock, pushHistory, completeWithoutPayment, markDraftsPlaced, giftCardCode, issueGiftCards };
