const express = require('express');
const config = require('../config');
const { Order, Review } = require('../models');
const { getContent } = require('../lib/content');
const { priceCart, priceCommission } = require('../lib/pricing');
const { newOrder, customerView, markDraftsPlaced } = require('../lib/orders');
const { validate, z, str, email, phone, url } = require('../middleware/validate');
const { limiters } = require('../middleware/security');
const { safeEqual, randomToken } = require('../lib/util');
const money = require('../lib/money');
const payments = require('../lib/payments');
const emailCode = require('../lib/email-code');
const { claimGuestOrders } = require('../lib/accounts');
const { ProofUpload } = require('../models');
const cloudinary = require('../services/cloudinary');
const upi = require('../services/upi');
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
}).prefault({});

// Finds an order the requester is allowed to act on: its owner, or anyone holding the secret link token.
async function findAccessibleOrder(req) {
  const order = await Order.findOne({ number: String(req.params.number).toUpperCase() });
  if (!order) return null;
  const token = String(req.query.t || req.body?.t || '');
  if (token && order.accessToken && safeEqual(token, order.accessToken)) return order;
  if (req.user && (String(order.userId) === String(req.user._id) || req.user.role === 'admin')) return order;
  return null;
}

// What the customer needs to pay by UPI: amount, UPI ID, a deep link and a QR code.
// The amount always comes from amountDue(), never from the browser.
async function upiPayload(order) {
  const due = money.amountDue(order);
  if (!due) return null;
  const site = await getContent('site');
  const upiId = upi.isValidUpiId(site.upiId) ? site.upiId : '';
  const base = { provider: 'upi', kind: due.kind, amount: due.amount, reference: order.number, upiName: site.upiName || config.brand.name };
  if (!upiId) return { ...base, upiId: '', message: 'June will send payment details by email shortly.' };
  const uri = upi.upiUri({ upiId, upiName: base.upiName, amount: due.amount, note: order.number });
  return { ...base, upiId, upiUri: uri, qrSvg: await upi.qrSvg(uri) };
}

// ---------- Checkout email code ----------
router.post('/checkout/email-code', limiters.auth, validate(z.object({ email: email() })), async (req, res) => {
  const result = await emailCode.sendCode(req.body.email, req.ip);
  // Same answer for every address: nothing here says whether someone has an account.
  res.json({ ok: true, sent: result.sent, disabled: Boolean(result.disabled), message: result.sent ? 'If that address can receive mail, a code is on its way.' : '' });
});

router.post('/checkout/email-code/verify', limiters.auth, validate(z.object({
  email: email(),
  code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits.'),
})), async (req, res) => {
  const proof = await emailCode.verifyCode(req.body.email, req.body.code);
  // Signed in with this same email: the code also proves the account's email.
  if (req.user && req.user.email === req.body.email && !req.user.emailVerified) {
    req.user.emailVerified = true;
    await req.user.save();
    await claimGuestOrders(req.user);
  }
  res.json({ ok: true, emailProof: proof });
});

// Shop checkout: priced on the server; the customer then pays by UPI and sends proof.
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
  }).optional().prefault({}),
  emailProof: z.string().max(2000).optional().default(''),
})), async (req, res) => {
  const b = req.body;
  // The email must be proven with a code, unless the signed-in account already proved it.
  const accountProven = Boolean(req.user?.emailVerified && req.user.email === b.email);
  const mode = emailCode.codeMode();
  if (mode === 'unavailable' && !accountProven) {
    return res.status(503).json({ error: 'Checkout is paused for a moment while we fix our email. Please message June on Instagram or WhatsApp to order.' });
  }
  const proven = accountProven || emailCode.checkProof(b.emailProof, b.email);
  if (mode === 'required' && !proven) {
    return res.status(400).json({ error: 'Please confirm your email with the code we send you.', field: 'email', needsEmailCode: true });
  }
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
    emailVerified: proven,
  });
  await order.save();
  await markDraftsPlaced(order.email);

  if (order.total === 0) {
    await payments.completeWithoutPayment(order);
    return res.status(201).json({ number: order.number, token: order.accessToken, payment: { provider: 'none', paid: true } });
  }

  // No email yet: the customer gets one when they send payment proof, and June gets the alert then.
  res.status(201).json({ number: order.number, token: order.accessToken, payment: await upiPayload(order) });
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

  await Promise.all([
    mail.send({ to: order.email, ...mail.templates.commissionReceived(order), key: `commission-received:${order._id}`, kind: 'commission' }),
    mail.notifyAdmin(`New commission ${order.number}`, [
      `${order.name} (${order.email}) · ${tier.title}`,
      b.occasion ? `Occasion: ${b.occasion}` : '',
      b.story.slice(0, 400),
    ].filter(Boolean), `/admin#orders/${order._id}`, { key: `admin-commission:${order._id}`, replyTo: order.email }),
  ]);

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
  const view = customerView(order);
  res.json({ order: view, payment: view.canPay ? await upiPayload(order) : null });
});

// Customer approves June's sketch and pays the deposit.
router.post('/orders/:number/approve', limiters.write, validate(z.object({
  t: z.string().optional(),
  couponCode: str(40).optional().default(''),
})), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.type !== 'commission' || order.status !== 'quoted' || order.amountPaid > 0) {
    return res.status(409).json({ error: 'This order isn’t waiting for approval.' });
  }
  if (money.openPayment(order)) return res.status(409).json({ error: 'We’re already checking a payment for this order.' });
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
  if (!order.commission.approvedAt) {
    order.commission.approvedAt = new Date();
    order.history.push({ status: 'payment', note: 'You approved the sketch. Pay the deposit to begin.' });
  }
  await order.save();
  await mail.notifyAdmin(`Sketch approved · ${order.number}`, [`${order.name} approved the sketch. The deposit of ₹${order.depositAmount} is next; you’ll get another email when they send payment proof.`], `/admin#orders/${order._id}`, { key: `admin-approved:${order._id}:${order.history.length}`, replyTo: order.email });
  res.json({ order: customerView(order), payment: await upiPayload(order) });
});

router.post('/orders/:number/changes', limiters.write, validate(z.object({
  t: z.string().optional(),
  message: str(2000).min(3, 'Tell June what you’d like changed.'),
})), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.type !== 'commission' || order.amountPaid > 0 || money.openPayment(order)) {
    return res.status(409).json({ error: 'Changes can be requested before the deposit is paid. Message June for anything else.' });
  }
  order.commission.changeRequests.push({ message: req.body.message });
  order.commission.approvedAt = undefined; // a new sketch needs a new approval
  order.status = 'received';
  order.history.push({ status: 'received', note: 'You asked for a few changes. June is updating the sketch.' });
  await order.save();
  await mail.notifyAdmin(`Changes requested on ${order.number}`, [req.body.message], `/admin#orders/${order._id}`, { key: `admin-changes:${order._id}:${order.commission.changeRequests.length}`, replyTo: order.email });
  res.json({ order: customerView(order) });
});

router.post('/orders/:number/pay', limiters.write, validate(z.object({ t: z.string().optional() })), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (money.openPayment(order)) return res.status(409).json({ error: 'We’re already checking a payment for this order.' });
  const payment = await upiPayload(order);
  if (!payment) return res.status(409).json({ error: 'Nothing is due on this order right now.' });
  res.json({ payment });
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
  await mail.notifyAdmin(`New ${req.body.rating}★ review on ${order.number}`, [req.body.text], '/admin#reviews', { key: `admin-review:${order._id}` });
  res.status(201).json({ ok: true });
});

// ---------- Payment proof (UTR + screenshot) ----------

// Step 1: a signed upload slot for this order's screenshot. The file name is chosen here, so the
// browser can only upload into this order's private folder.
router.post('/orders/:number/payment-proof/sign', limiters.upload, validate(z.object({ t: z.string().optional() })), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!money.amountDue(order) || money.openPayment(order)) return res.status(409).json({ error: 'Nothing is due on this order right now.' });
  if ((await ProofUpload.countDocuments({ orderId: order._id, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } })) >= 15) {
    return res.status(429).json({ error: 'Too many uploads for this order. Please try again in an hour.' });
  }
  if (config.features.cloudinary) {
    const publicId = `artorabyjune/payments/${order.number}/${randomToken(12)}`;
    await ProofUpload.create({ publicId, provider: 'cloudinary', orderId: order._id });
    return res.json(cloudinary.signPrivateUpload(publicId));
  }
  if (config.isProd && !process.env.ALLOW_LOCAL_UPLOADS) {
    return res.status(503).json({ error: 'Screenshot uploads aren’t set up yet. Please message June on WhatsApp with your payment screenshot.' });
  }
  const publicId = `${order.number}-${randomToken(12)}`;
  await ProofUpload.create({ publicId, provider: 'local', orderId: order._id });
  res.json({ provider: 'local', publicId });
});

const SIGNATURES = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

// Step 2 (local storage only, i.e. development): the file goes to a private folder that is never
// served publicly; only the admin proof route reads it.
router.post('/orders/:number/payment-proof/local', limiters.upload, express.json({ limit: '6mb' }), async (req, res) => {
  if (config.features.cloudinary || (config.isProd && !process.env.ALLOW_LOCAL_UPLOADS)) return res.status(404).json({ error: 'Not found.' });
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const publicId = String(req.body?.publicId || '');
  const upload = await ProofUpload.findOne({ publicId, orderId: order._id, provider: 'local', attachedTo: { $exists: false } });
  if (!upload) return res.status(400).json({ error: 'Please upload the screenshot again.' });
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
  if (!match) return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP image.' });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'That image is too large (max 4 MB).' });
  if (!SIGNATURES.some((sig) => sig.test(buffer))) return res.status(400).json({ error: 'That file doesn’t look like an image.' });
  await require('../lib/proof-files').saveLocal(publicId, buffer);
  res.status(201).json({ ok: true, publicId });
});

// Step 3: the customer sends the UTR with the uploaded screenshot.
router.post('/orders/:number/payment-proof', limiters.write, validate(z.object({
  t: z.string().optional(),
  kind: z.enum(['full', 'deposit', 'balance']),
  utr: z.string().trim().max(40),
  proof: z.object({
    publicId: z.string().trim().min(1).max(200),
    version: z.union([z.string(), z.number()]).optional(),
    signature: z.string().trim().max(128).optional(),
  }),
})), async (req, res) => {
  const order = await findAccessibleOrder(req);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const { proof } = req.body;
  let provider = 'local';
  if (config.features.cloudinary) {
    provider = 'cloudinary';
    if (!proof.publicId.startsWith(`artorabyjune/payments/${order.number}/`)) return res.status(400).json({ error: 'Please upload the screenshot again.', field: 'screenshot' });
    if (!cloudinary.verifyUploadResponse({ publicId: proof.publicId, version: proof.version, signature: proof.signature })) {
      return res.status(400).json({ error: 'We couldn’t confirm that screenshot upload. Please upload it again.', field: 'screenshot' });
    }
  } else if (!(await require('../lib/proof-files').existsLocal(proof.publicId))) {
    return res.status(400).json({ error: 'Please upload the screenshot again.', field: 'screenshot' });
  }
  try {
    await payments.submitProof(order, { kind: req.body.kind, utr: req.body.utr, publicId: proof.publicId, provider });
  } catch (error) {
    if (error.expose) return res.status(error.status || 400).json({ error: error.message, field: error.field });
    throw error;
  }
  const fresh = await Order.findById(order._id);
  res.status(201).json({ order: customerView(fresh) });
});

module.exports = router;
