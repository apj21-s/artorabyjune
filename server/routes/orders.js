const express = require('express');
const config = require('../config');
const { Order, Review } = require('../models');
const { getContent } = require('../lib/content');
const { priceCart, priceCommission } = require('../lib/pricing');
const { newOrder, markPaymentPaid, customerView, completeWithoutPayment, markDraftsPlaced } = require('../lib/orders');
const { validate, z, str, email, phone, url } = require('../middleware/validate');
const { limiters } = require('../middleware/security');
const { safeEqual } = require('../lib/util');
const razorpay = require('../services/razorpay');
const mail = require('../services/email');

const router = express.Router();

const address = z.object({
  name: str(80).min(1, 'Please add the recipient’s name.'),
  phone: phone().min(10, 'Please add a phone number for the courier.'),
  line1: str(200).min(3, 'Please add the address.'),
  line2: str(200).optional().default(''),
  city: str(80).min(2, 'Please add the city.'),
  state: str(80).min(2, 'Please add the state.'),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Please enter a 6-digit pincode.'),
});

const gift = z.object({
  isGift: z.boolean().default(false),
  note: str(400).optional().default(''),
  wrap: z.boolean().default(false),
}).default({});

// Finds an order the requester is allowed to act on: its owner, or anyone holding the secret link token.
async function findAccessibleOrder(req) {
  const order = await Order.findOne({ number: String(req.params.number).toUpperCase() });
  if (!order) return null;
  const token = String(req.query.t || req.body?.t || '');
  if (token && order.accessToken && safeEqual(token, order.accessToken)) return order;
  if (req.user && (String(order.userId) === String(req.user._id) || req.user.role === 'admin')) return order;
  return null;
}

async function razorpayPayload(order, { kind, amount }) {
  const rp = await razorpay.createOrder({
    amount,
    receipt: `${order.number}-${kind}-${order.payments.length + 1}`,
    notes: { orderNumber: order.number, kind },
  });
  order.payments.push({ kind, amount, method: 'razorpay', status: 'created', razorpayOrderId: rp.id });
  await order.save();
  return {
    provider: 'razorpay',
    key: config.razorpay.keyId,
    orderId: rp.id,
    amount: rp.amount,
    currency: 'INR',
    name: config.brand.name,
    description: `${order.number} · ${kind === 'deposit' ? 'Deposit' : kind === 'balance' ? 'Balance' : 'Order'}`,
    prefill: { name: order.name, email: order.email, contact: order.phone || '' },
  };
}

async function manualPayload(amount, order) {
  const site = await getContent('site');
  return {
    provider: 'manual',
    amount,
    upiId: site.upiId,
    upiName: site.upiName,
    reference: order.number,
    message: site.upiId
      ? `Pay ₹${amount} to the UPI ID below with “${order.number}” in the note. June will confirm by email.`
      : 'June will send payment details by email shortly.',
  };
}

async function paymentFor(order, kind, amount) {
  if (razorpay.enabled()) return razorpayPayload(order, { kind, amount });
  return manualPayload(amount, order);
}

// Shop checkout: priced on the server, then handed to Razorpay.
router.post('/checkout', limiters.write, validate(z.object({
  items: z.array(z.object({
    productId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid item.'),
    qty: z.coerce.number().int().min(1).max(10),
  })).min(1, 'Your cart is empty.').max(30),
  couponCode: str(40).optional().default(''),
  giftCode: str(40).optional().default(''),
  name: str(80).min(1, 'Please tell us your name.'),
  email: email(),
  phone: phone().min(10, 'Please add a phone number.'),
  address: address.optional(),
  gift,
  giftCard: z.object({
    recipientEmail: z.union([email(), z.literal('')]).optional().default(''),
    recipientName: str(80).optional().default(''),
    message: str(400).optional().default(''),
  }).optional().default({}),
})), async (req, res) => {
  const b = req.body;
  const priced = await priceCart({ items: b.items, couponCode: b.couponCode, giftWrap: b.gift.wrap, giftCode: b.giftCode });
  if (priced.problems.length) return res.status(409).json({ error: priced.problems[0].message, problems: priced.problems });
  // Gift cards are emailed, so an address is only needed when there's a tote to post.
  if (priced.needsShipping && !b.address) return res.status(400).json({ error: 'Please add the delivery address.', field: 'address.line1' });

  const order = await newOrder({
    type: 'shop',
    userId: req.user?._id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    items: priced.lines,
    gift: b.gift,
    shippingAddress: priced.needsShipping ? b.address : undefined,
    couponCode: priced.couponCode,
    bundleDiscount: priced.bundleDiscount,
    giftCardCode: priced.giftCardCode,
    giftCardAmount: priced.giftCardAmount,
    giftCardRecipient: priced.hasGiftCards ? { email: b.giftCard.recipientEmail || b.email, name: b.giftCard.recipientName, message: b.giftCard.message } : undefined,
    subtotal: priced.subtotal,
    discount: priced.discount,
    shippingFee: priced.shippingFee,
    giftWrapFee: priced.giftWrapFee,
    total: priced.total,
  });
  await order.save();
  await markDraftsPlaced(order.email);

  if (order.total === 0) {
    await completeWithoutPayment(order);
    return res.status(201).json({ number: order.number, token: order.accessToken, payment: { provider: 'none', paid: true } });
  }

  const payment = await paymentFor(order, 'full', order.total);
  if (payment.provider === 'manual') {
    await mail.send({ to: order.email, ...mail.templates.shopOrderPlaced(order) });
    await mail.notifyAdmin(`New shop order ${order.number} (awaiting UPI)`, [`${order.name} · ₹${order.total}`], `/admin#orders/${order._id}`);
  }
  res.status(201).json({ number: order.number, token: order.accessToken, payment });
});

// Custom commission request. No payment yet — June quotes first.
router.post('/commissions', limiters.write, validate(z.object({
  tier: str(40).min(1, 'Please choose a canvas.'),
  style: str(40).optional().default('Tote'),
  baseColour: str(40).optional().default('Natural'),
  occasion: str(60).optional().default(''),
  story: str(4000).min(10, 'Tell June a little more about your story (at least a sentence).'),
  include: str(500).optional().default(''),
  moods: z.array(str(30)).max(6).optional().default([]),
  references: z.array(url()).max(5).optional().default([]),
  deadline: z.string().trim().optional().default('').refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  name: str(80).min(1, 'Please sign your note with your name.'),
  email: email(),
  phone: phone().optional().default(''),
  gift,
})), async (req, res) => {
  const b = req.body;
  const tiers = await getContent('tiers');
  const tier = tiers.find((t) => t.key === b.tier);
  if (!tier) return res.status(400).json({ error: 'Please choose a canvas size.', field: 'tier' });

  const order = await newOrder({
    type: 'commission',
    userId: req.user?._id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    gift: b.gift,
    subtotal: tier.price,
    total: 0,
    commission: {
      tier: tier.key,
      tierTitle: tier.title,
      style: b.style,
      baseColour: b.baseColour,
      occasion: b.occasion,
      story: b.story,
      include: b.include,
      moods: b.moods,
      references: b.references,
      deadline: b.deadline ? new Date(b.deadline) : undefined,
    },
  });
  await order.save();

  await mail.send({ to: order.email, ...mail.templates.commissionReceived(order) });
  await mail.notifyAdmin(`New commission ${order.number}`, [
    `${order.name} (${order.email}) · ${tier.title}`,
    b.occasion ? `Occasion: ${b.occasion}` : '',
    b.story.slice(0, 400),
  ].filter(Boolean), `/admin#orders/${order._id}`);

  res.status(201).json({ number: order.number, token: order.accessToken });
});

router.get('/orders/track', limiters.write, async (req, res) => {
  const number = String(req.query.number || '').trim().toUpperCase();
  const mailAddr = String(req.query.email || '').trim().toLowerCase();
  if (!number || !mailAddr) return res.status(400).json({ error: 'Please enter your order number and email.' });
  const order = await Order.findOne({ number, email: mailAddr });
  if (!order) return res.status(404).json({ error: 'We couldn’t find that order. Check the number and email you used.' });
  const view = customerView(order);
  // The tracking lookup is lighter than a magic link: no story or address details.
  res.json({
    order: {
      number: view.number,
      type: view.type,
      status: view.status,
      statusLabel: view.statusLabel,
      createdAt: view.createdAt,
      timeline: view.timeline,
      tracking: view.tracking,
      paymentStatus: view.paymentStatus,
    },
  });
});

router.get('/orders/:number', async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'We couldn’t open that order. Try the link in your email, or sign in.' });
  // Opening the private order link while signed in adds the order to that account (the link is the proof).
  const token = String(req.query.t || '');
  if (req.user && !order.userId && token && order.accessToken && safeEqual(token, order.accessToken)) {
    order.userId = req.user._id;
    await order.save();
  }
  res.json({ order: customerView(order), payments: razorpay.enabled() ? 'razorpay' : 'manual' });
});

// Customer approves June's sketch and pays the deposit.
router.post('/orders/:number/approve', limiters.write, validate(z.object({
  t: z.string().optional(),
  couponCode: str(40).optional().default(''),
})), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.type !== 'commission' || order.status !== 'quoted') {
    return res.status(409).json({ error: 'This order isn’t waiting for approval.' });
  }
  if (req.body.couponCode && req.body.couponCode.toUpperCase() !== order.couponCode) {
    const priced = await priceCommission({ quote: order.subtotal, couponCode: req.body.couponCode, giftWrap: order.gift?.wrap });
    Object.assign(order, {
      couponCode: priced.couponCode,
      discount: priced.discount,
      giftWrapFee: priced.giftWrapFee,
      total: priced.total,
      depositAmount: priced.depositAmount,
    });
  }
  order.commission.approvedAt = new Date();
  await order.save();
  const payment = await paymentFor(order, 'deposit', order.depositAmount || order.total);
  res.json({ order: customerView(order), payment });
});

router.post('/orders/:number/changes', limiters.write, validate(z.object({
  t: z.string().optional(),
  message: str(2000).min(3, 'Tell June what you’d like changed.'),
})), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.type !== 'commission' || order.amountPaid > 0) {
    return res.status(409).json({ error: 'Changes can be requested before the deposit is paid. Message June for anything else.' });
  }
  order.commission.changeRequests.push({ message: req.body.message });
  order.status = 'received';
  order.history.push({ status: 'received', note: 'You asked for a few changes. June is updating the sketch.' });
  await order.save();
  await mail.notifyAdmin(`Changes requested on ${order.number}`, [req.body.message], `/admin#orders/${order._id}`);
  res.json({ order: customerView(order) });
});

router.post('/orders/:number/pay', limiters.write, validate(z.object({ t: z.string().optional() })), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const view = customerView(order);
  if (view.canPayBalance) return res.json({ payment: await paymentFor(order, 'balance', view.balanceDue) });
  if (view.canPayShop) return res.json({ payment: await paymentFor(order, 'full', order.total) });
  return res.status(409).json({ error: 'Nothing is due on this order right now.' });
});

router.post('/orders/:number/review', limiters.write, validate(z.object({
  t: z.string().optional(),
  rating: z.coerce.number().int().min(1).max(5),
  text: str(1500).min(5, 'Write a few words, please.'),
  city: str(60).optional().default(''),
  photo: url().optional().default(''),
})), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status !== 'delivered') return res.status(409).json({ error: 'Reviews open once your story arrives.' });
  if (await Review.exists({ orderNumber: order.number })) return res.status(409).json({ error: 'Thank you — you’ve already left a review for this order.' });
  await Review.create({
    name: (order.name || 'Customer').split(' ')[0],
    city: req.body.city,
    rating: req.body.rating,
    text: req.body.text,
    photo: req.body.photo,
    orderNumber: order.number,
    approved: false,
  });
  await mail.notifyAdmin(`New ${req.body.rating}★ review on ${order.number}`, [req.body.text], '/admin#reviews');
  res.status(201).json({ ok: true });
});

// Browser callback after Razorpay checkout succeeds.
router.post('/payments/verify', limiters.write, validate(z.object({
  number: str(20),
  t: z.string().optional(),
  razorpay_order_id: str(60),
  razorpay_payment_id: str(60),
  razorpay_signature: str(200),
})), async (req, res) => {
  req.params.number = req.body.number;
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const valid = razorpay.verifyPaymentSignature({
    orderId: req.body.razorpay_order_id,
    paymentId: req.body.razorpay_payment_id,
    signature: req.body.razorpay_signature,
  });
  const pending = order.payments.find((p) => p.razorpayOrderId === req.body.razorpay_order_id);
  if (!valid || !pending) return res.status(400).json({ error: 'We couldn’t verify that payment. If money left your account, contact us and we’ll sort it out.' });
  await markPaymentPaid(order, {
    razorpayOrderId: pending.razorpayOrderId,
    razorpayPaymentId: req.body.razorpay_payment_id,
    amount: pending.amount,
    kind: pending.kind,
  });
  res.json({ order: customerView(order) });
});

module.exports = router;

// Razorpay webhook: backup confirmation if the customer closes the tab mid-payment.
// Mounted separately with a raw body parser so the signature can be checked.
async function webhookHandler(req, res) {
  const signature = req.get('x-razorpay-signature');
  if (!razorpay.verifyWebhookSignature(req.body, signature)) return res.status(400).json({ error: 'Invalid signature.' });
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).end(); }
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const entity = event.payload?.payment?.entity;
    const rpOrderId = entity?.order_id;
    if (rpOrderId) {
      const order = await Order.findOne({ 'payments.razorpayOrderId': rpOrderId });
      const pending = order?.payments.find((p) => p.razorpayOrderId === rpOrderId);
      if (order && pending) {
        await markPaymentPaid(order, {
          razorpayOrderId: rpOrderId,
          razorpayPaymentId: entity.id,
          amount: pending.amount,
          kind: pending.kind,
        });
      }
    }
  }
  res.json({ ok: true });
}

module.exports.webhookHandler = webhookHandler;
