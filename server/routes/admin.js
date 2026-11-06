const express = require('express');
const config = require('../config');
const { Order, Product, Coupon, Review, Message, Subscriber, User, Content, GiftCard } = require('../models');
const { giftCardCode } = require('../lib/orders');
const { requireAdmin } = require('../middleware/auth');
const { validate, z, str, url, email } = require('../middleware/validate');
const { getContent, setContent, EDITABLE_KEYS, DEFAULTS } = require('../lib/content');
const { priceCommission, priceCart, PricingError } = require('../lib/pricing');
const { setStatus, markPaymentPaid, customerView, pushHistory, newOrder } = require('../lib/orders');
const { STAGES, flowFor } = require('../lib/stages');
const { slugify, escapeRegex } = require('../lib/util');
const mail = require('../services/email');

const router = express.Router();
router.use(requireAdmin);

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

router.param('id', (req, res, next, id) => {
  if (!objectId.safeParse(id).success) return res.status(404).json({ error: 'Not found.' });
  next();
});

// ---------- Overview ----------
router.get('/stats', async (_req, res) => {
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [revenue30, revenueAll, openCommissions, awaitingQuote, toShip, lowStock, unreadMessages, pendingReviews, recent, awaitingPayment] = await Promise.all([
    Order.aggregate([{ $match: { createdAt: { $gte: since30 } } }, { $group: { _id: null, sum: { $sum: '$amountPaid' } } }]),
    Order.aggregate([{ $group: { _id: null, sum: { $sum: '$amountPaid' }, count: { $sum: 1 } } }]),
    Order.countDocuments({ type: 'commission', status: { $nin: ['delivered', 'cancelled'] } }),
    Order.countDocuments({ type: 'commission', status: 'received' }),
    Order.countDocuments({ status: { $in: ['confirmed', 'packing'] }, paymentStatus: { $in: ['paid', 'deposit_paid'] } }),
    Product.find({ status: 'live', stock: { $lte: 1 } }).select('title stock slug').limit(10).lean(),
    Message.countDocuments({ handled: false }),
    Review.countDocuments({ approved: false }),
    Order.find().sort({ createdAt: -1 }).limit(6).select('number type name status total amountPaid createdAt paymentStatus').lean(),
    Order.countDocuments({ type: 'shop', status: 'received', paymentStatus: 'unpaid' }),
  ]);
  const launch = await getContent('launch');
  res.json({
    revenue30: revenue30[0]?.sum || 0,
    revenueAll: revenueAll[0]?.sum || 0,
    orderCount: revenueAll[0]?.count || 0,
    openCommissions,
    awaitingQuote,
    toShip,
    lowStock,
    unreadMessages,
    pendingReviews,
    awaitingPayment,
    recent: recent.map((o) => ({ ...o, statusLabel: STAGES[o.status]?.label || o.status })),
    checklist: [
      { key: 'payments', label: 'Online payments (Razorpay) connected', done: config.features.razorpay, hint: 'Until then customers pay your UPI ID and you confirm it here. Set up: handover guide, Step 10.' },
      { key: 'email', label: 'Order emails (Resend) connected', done: config.features.email, hint: 'Until then no emails go out. Set up: handover guide, Step 9 (needs your own domain).' },
      { key: 'uploads', label: 'Photo storage (Cloudinary) connected', done: config.features.cloudinary, hint: 'Needed to upload product photos and sketches. Set up: handover guide, Step 6.' },
      { key: 'pricingReviewed', label: 'Commission prices and turnaround reviewed', done: Boolean(launch.pricingReviewed), manual: true },
      { key: 'reviewsReal', label: 'Sample reviews replaced with real ones', done: Boolean(launch.reviewsReal), manual: true },
      { key: 'legalReviewed', label: 'Privacy, terms and returns pages reviewed', done: Boolean(launch.legalReviewed), manual: true },
    ],
  });
});

// ---------- Orders & commissions ----------
router.get('/orders', async (req, res) => {
  const filter = {};
  if (['shop', 'commission'].includes(req.query.type)) filter.type = req.query.type;
  if (req.query.status && STAGES[req.query.status]) filter.status = req.query.status;
  if (req.query.open === '1') filter.status = { $nin: ['delivered', 'cancelled'] };
  if (req.query.q) {
    const q = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
    filter.$or = [{ number: q }, { name: q }, { email: q }, { phone: q }];
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 25;
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage)
      .select('number type name email status paymentStatus total amountPaid createdAt commission.tierTitle commission.deadline items.title items.qty')
      .lean(),
    Order.countDocuments(filter),
  ]);
  res.json({
    items: items.map((o) => ({ ...o, statusLabel: STAGES[o.status]?.label || o.status })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / perPage)),
  });
});

router.get('/orders.csv', async (_req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 }).lean();
  const cols = ['number', 'type', 'createdAt', 'name', 'email', 'phone', 'status', 'paymentStatus', 'total', 'amountPaid', 'couponCode', 'city', 'pincode', 'items'];
  const cell = (v) => {
    const s = String(v ?? '');
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // stop spreadsheet formula injection
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = orders.map((o) => [
    o.number, o.type, o.createdAt?.toISOString(), o.name, o.email, o.phone, o.status, o.paymentStatus, o.total, o.amountPaid, o.couponCode,
    o.shippingAddress?.city, o.shippingAddress?.pincode,
    o.type === 'shop' ? o.items.map((i) => `${i.title} x${i.qty}`).join('; ') : o.commission?.tierTitle,
  ].map(cell).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="artora-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([cols.join(','), ...rows].join('\n'));
});

router.get('/orders/:id', async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({
    order: {
      ...customerView(order),
      id: order._id,
      phone: order.phone,
      token: order.accessToken,
      payments: order.payments,
      internalNotes: order.internalNotes || '',
      source: order.source || 'website',
      sourceHandle: order.sourceHandle || '',
      history: order.history,
    },
    flow: flowFor(order.type).map((key) => ({ key, label: STAGES[key].label })),
  });
});

router.patch('/orders/:id', validate(z.object({
  status: z.string().optional(),
  note: str(1000).optional().default(''),
  notify: z.boolean().optional().default(true),
  tracking: z.object({ courier: str(60).optional().default(''), number: str(80).optional().default(''), url: z.string().trim().max(500).optional().default('') }).optional(),
  internalNotes: str(4000).optional(),
})), async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (req.body.tracking) order.tracking = req.body.tracking;
  if (req.body.internalNotes !== undefined) order.internalNotes = req.body.internalNotes;
  if (req.body.status && req.body.status !== order.status) {
    await setStatus(order, req.body.status, { note: req.body.note, notify: req.body.notify });
  } else {
    if (req.body.note) pushHistory(order, order.status, req.body.note);
    await order.save();
  }
  res.json({ ok: true });
});

router.post('/orders/:id/quote', validate(z.object({
  price: z.coerce.number().int().min(1, 'Add a price.').max(1_000_000),
  message: str(2000).optional().default(''),
  sketchImage: url().optional().default(''),
  notify: z.boolean().optional().default(true),
})), async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order || order.type !== 'commission') return res.status(404).json({ error: 'Commission not found.' });
  if (order.amountPaid > 0) return res.status(409).json({ error: 'The deposit is already paid; the quote can’t change now.' });
  const priced = await priceCommission({ quote: req.body.price, couponCode: '', giftWrap: order.gift?.wrap });
  Object.assign(order, {
    subtotal: priced.subtotal,
    discount: 0,
    couponCode: '',
    giftWrapFee: priced.giftWrapFee,
    total: priced.total,
    depositAmount: priced.depositAmount,
  });
  order.commission.quoteMessage = req.body.message;
  order.commission.sketchImage = req.body.sketchImage;
  order.commission.quotedAt = new Date();
  order.status = 'quoted';
  pushHistory(order, 'quoted');
  await order.save();
  if (req.body.notify) await mail.send({ to: order.email, ...mail.templates.quoteReady(order) });
  res.json({ ok: true, total: order.total, depositAmount: order.depositAmount });
});

router.post('/orders/:id/payments', validate(z.object({
  kind: z.enum(['full', 'deposit', 'balance']),
  amount: z.coerce.number().int().min(1).max(1_000_000),
  note: str(300).optional().default('Recorded manually'),
})), async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  await markPaymentPaid(order, { kind: req.body.kind, amount: req.body.amount, method: 'manual', note: req.body.note });
  res.json({ ok: true });
});

// ---------- Orders taken outside the website (Instagram DM, WhatsApp, in person) ----------
// June types them in; they behave exactly like website orders, and show up in the customer's
// account automatically because accounts match orders by email.
const SOURCE_LABEL = { instagram: 'Instagram', whatsapp: 'WhatsApp', in_person: 'in person', phone: 'a phone call', other: 'a message' };
const optStr = (n) => str(n).optional().default('');
router.post('/orders/manual', validate(z.object({
  type: z.enum(['shop', 'commission']),
  source: z.enum(['instagram', 'whatsapp', 'in_person', 'phone', 'other']).default('instagram'),
  handle: optStr(80),
  name: str(80).min(1, 'Add the customer’s name.'),
  email: email(),
  phone: optStr(20),
  items: z.array(z.object({ productId: objectId, qty: z.coerce.number().int().min(1).max(20) })).max(20).optional().default([]),
  tier: optStr(40),
  story: optStr(4000),
  price: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
  discount: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
  address: z.object({ name: optStr(80), phone: optStr(20), line1: optStr(200), line2: optStr(200), city: optStr(80), state: optStr(80), pincode: optStr(10) }).optional().default({}),
  paid: z.enum(['none', 'deposit', 'full']).default('none'),
  paidAmount: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
  paymentNote: optStr(300),
  notes: optStr(2000),
  notify: z.boolean().optional().default(true),
})), async (req, res) => {
  const b = req.body;
  const from = SOURCE_LABEL[b.source] + (b.handle ? ` (${b.handle})` : '');
  const user = await User.findOne({ email: b.email }).select('_id');
  const address = b.address.line1 ? { ...b.address, name: b.address.name || b.name, phone: b.address.phone || b.phone } : undefined;
  const base = { source: b.source, sourceHandle: b.handle, userId: user?._id, name: b.name, email: b.email, phone: b.phone, shippingAddress: address, internalNotes: b.notes };
  let order;

  if (b.type === 'shop') {
    if (!b.items.length) return res.status(400).json({ error: 'Pick at least one tote.' });
    let priced;
    try { priced = await priceCart({ items: b.items }); } catch (error) {
      if (error instanceof PricingError) return res.status(400).json({ error: error.message });
      throw error;
    }
    if (priced.problems.length) return res.status(409).json({ error: priced.problems[0].message });
    const discount = Math.min(b.discount, priced.total);
    order = await newOrder({ ...base, type: 'shop', items: priced.lines, subtotal: priced.subtotal, discount: priced.discount + discount,
      bundleDiscount: priced.bundleDiscount, shippingFee: priced.shippingFee, total: priced.total - discount });
  } else {
    if (b.story.trim().length < 3) return res.status(400).json({ error: 'Write a line about what to paint.' });
    const tiers = await getContent('tiers');
    const tier = tiers.find((t) => t.key === b.tier) || null;
    order = await newOrder({ ...base, type: 'commission', subtotal: tier?.price || 0, total: 0,
      commission: { tier: tier?.key || '', tierTitle: tier?.title || 'Custom', style: 'Tote', baseColour: 'Natural', story: b.story } });
    if (b.price > 0) {
      const priced = await priceCommission({ quote: b.price });
      Object.assign(order, { subtotal: priced.subtotal, total: priced.total, depositAmount: priced.depositAmount });
      order.commission.quotedAt = new Date();
      order.commission.approvedAt = new Date(); // agreed in the chat
      order.status = 'quoted';
      pushHistory(order, 'quoted', `Price agreed on ${from}.`);
    }
  }
  order.history[0].note = `Order taken on ${from}.`;
  await order.save();

  if (b.paid !== 'none') {
    if (!order.total) return res.status(400).json({ error: 'Add a price before recording a payment.' });
    const amount = b.paidAmount || (b.paid === 'full' ? order.total : order.depositAmount || Math.ceil(order.total / 2));
    await markPaymentPaid(order, { kind: b.paid === 'full' ? 'full' : 'deposit', amount, method: 'manual', note: b.paymentNote || `Paid on ${from}` });
  } else if (b.notify) {
    if (order.type === 'shop') await mail.send({ to: order.email, ...mail.templates.shopOrderPlaced(order) });
    else if (order.status === 'quoted') await mail.send({ to: order.email, ...mail.templates.quoteReady(order) });
    else await mail.send({ to: order.email, ...mail.templates.commissionReceived(order) });
  }
  res.status(201).json({ id: order._id, number: order.number });
});

// ---------- Products ----------
const productSchema = z.object({
  title: str(120).min(1, 'Add a title.'),
  slug: str(80).optional().default(''),
  summary: str(300).optional().default(''),
  description: str(5000).optional().default(''),
  price: z.coerce.number().int().min(0).max(1_000_000),
  compareAt: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  images: z.array(url()).max(8).optional().default([]),
  stock: z.coerce.number().int().min(0).max(10_000).default(1),
  status: z.enum(['draft', 'live']).default('live'),
  tags: z.array(str(40)).max(12).optional().default([]),
  colour: str(40).optional().default(''),
  featured: z.boolean().optional().default(false),
  badge: str(30).optional().default(''),
  details: z.object({ size: str(120).optional().default(''), material: str(200).optional().default(''), care: str(500).optional().default('') }).optional().default({}),
  sortOrder: z.coerce.number().int().optional().default(0),
  kind: z.enum(['tote', 'giftcard']).optional().default('tote'),
  bundleWithSlug: str(80).optional().default(''),
  bundleDiscount: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

// The admin names a bundle partner by its slug; store the product id.
async function resolveBundle(body) {
  const { bundleWithSlug, ...rest } = body;
  const partner = bundleWithSlug ? await Product.findOne({ slug: bundleWithSlug.trim() }) : null;
  if (bundleWithSlug && !partner) throw Object.assign(new Error(`No product with the slug “${bundleWithSlug}”.`), { status: 400, expose: true });
  return { ...rest, bundleWith: partner ? partner._id : null };
}

router.get('/products', async (_req, res) => {
  const items = await Product.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  const slugs = new Map(items.map((p) => [String(p._id), p.slug]));
  res.json({ items: items.map((p) => ({ ...p, bundleWithSlug: p.bundleWith ? slugs.get(String(p.bundleWith)) || '' : '' })) });
});

async function uniqueSlug(base, ignoreId) {
  let slug = slugify(base);
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Product.exists({ slug, ...(ignoreId ? { _id: { $ne: ignoreId } } : {}) })) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

router.post('/products', validate(productSchema), async (req, res) => {
  const data = { ...(await resolveBundle(req.body)), slug: await uniqueSlug(req.body.slug || req.body.title) };
  const product = await Product.create(data);
  res.status(201).json({ item: product });
});

router.put('/products/:id', validate(productSchema), async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const wasOut = product.stock === 0;
  Object.assign(product, await resolveBundle(req.body), { slug: await uniqueSlug(req.body.slug || req.body.title, product._id) });
  await product.save();
  if (wasOut && product.stock > 0 && product.status === 'live') {
    const waiting = await Subscriber.find({ kind: 'restock', productId: product._id, notifiedAt: { $exists: false } });
    for (const sub of waiting) {
      await mail.send({ to: sub.email, ...mail.templates.restock(sub.email, product) });
      sub.notifiedAt = new Date();
      await sub.save();
    }
  }
  res.json({ item: product });
});

router.delete('/products/:id', async (req, res) => {
  await Product.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ---------- Gift cards (store credit) ----------
const giftCardSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,30}$/).optional().or(z.literal('')).default(''),
  initialAmount: z.coerce.number().int().min(1).max(100000),
  balance: z.coerce.number().int().min(0).max(100000).optional(),
  recipientEmail: z.union([z.string().trim().toLowerCase().email(), z.literal('')]).optional().default(''),
  recipientName: str(80).optional().default(''),
  expiresAt: z.string().optional().nullable().transform((v) => (v ? new Date(v) : null)),
  active: z.boolean().default(true),
  note: str(200).optional().default(''),
});
router.get('/giftcards', async (_req, res) => res.json({ items: await GiftCard.find().sort({ createdAt: -1 }).limit(500).lean() }));
router.post('/giftcards', validate(giftCardSchema), async (req, res) => {
  const b = req.body;
  const item = await GiftCard.create({ ...b, code: b.code || giftCardCode(), balance: b.balance ?? b.initialAmount });
  res.status(201).json({ item });
});
router.put('/giftcards/:id', validate(giftCardSchema), async (req, res) => {
  const { code, ...rest } = req.body;
  const item = await GiftCard.findByIdAndUpdate(req.params.id, { ...rest, ...(code ? { code } : {}) }, { new: true });
  if (!item) return res.status(404).json({ error: 'Gift card not found.' });
  res.json({ item });
});
router.delete('/giftcards/:id', async (req, res) => {
  await GiftCard.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ---------- Coupons ----------
const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Codes use letters, numbers, - or _ (3–30).'),
  kind: z.enum(['percent', 'flat']),
  value: z.coerce.number().min(0).max(100000),
  minOrder: z.coerce.number().min(0).optional().default(0),
  appliesTo: z.enum(['all', 'shop', 'commission']).default('all'),
  expiresAt: z.string().optional().nullable().transform((v) => (v ? new Date(v) : null)),
  usageLimit: z.coerce.number().int().min(0).optional().default(0),
  active: z.boolean().default(true),
  note: str(200).optional().default(''),
}).refine((c) => c.kind !== 'percent' || c.value <= 100, { message: 'Percent coupons can’t exceed 100.', path: ['value'] });

router.get('/coupons', async (_req, res) => res.json({ items: await Coupon.find().sort({ createdAt: -1 }).lean() }));
router.post('/coupons', validate(couponSchema), async (req, res) => res.status(201).json({ item: await Coupon.create(req.body) }));
router.put('/coupons/:id', validate(couponSchema), async (req, res) => {
  const item = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!item) return res.status(404).json({ error: 'Coupon not found.' });
  res.json({ item });
});
router.delete('/coupons/:id', async (req, res) => {
  await Coupon.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ---------- Reviews ----------
const reviewSchema = z.object({
  name: str(60).min(1),
  city: str(60).optional().default(''),
  rating: z.coerce.number().int().min(1).max(5),
  text: str(1500).min(1),
  photo: url().optional().default(''),
  approved: z.boolean().default(true),
  featured: z.boolean().default(false),
});
router.get('/reviews', async (_req, res) => res.json({ items: await Review.find().sort({ approved: 1, createdAt: -1 }).lean() }));
router.post('/reviews', validate(reviewSchema), async (req, res) => res.status(201).json({ item: await Review.create(req.body) }));
router.put('/reviews/:id', validate(reviewSchema), async (req, res) => {
  const item = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!item) return res.status(404).json({ error: 'Review not found.' });
  res.json({ item });
});
router.delete('/reviews/:id', async (req, res) => {
  await Review.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ---------- Content ----------
router.get('/content', async (_req, res) => {
  const entries = await Promise.all(EDITABLE_KEYS.map(async (key) => [key, await getContent(key)]));
  res.json(Object.fromEntries(entries));
});

router.put('/content/:key', async (req, res) => {
  const { key } = req.params;
  if (!EDITABLE_KEYS.includes(key)) return res.status(400).json({ error: 'That section can’t be edited.' });
  const data = req.body;
  const expectArray = Array.isArray(DEFAULTS[key]);
  if (expectArray !== Array.isArray(data) || data === null || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid content format.' });
  }
  if (JSON.stringify(data).length > 200_000) return res.status(413).json({ error: 'That content is too large.' });
  res.json({ key, data: await setContent(key, data) });
});

// ---------- Messages & subscribers ----------
router.get('/messages', async (_req, res) => res.json({ items: await Message.find().sort({ handled: 1, createdAt: -1 }).limit(200).lean() }));
router.patch('/messages/:id', validate(z.object({ handled: z.boolean() })), async (req, res) => {
  await Message.updateOne({ _id: req.params.id }, { handled: req.body.handled });
  res.json({ ok: true });
});

router.get('/subscribers', async (_req, res) => res.json({ items: await Subscriber.find().sort({ createdAt: -1 }).limit(1000).lean() }));
router.get('/subscribers.csv', async (_req, res) => {
  const subs = await Subscriber.find({ kind: 'newsletter' }).lean();
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="artora-subscribers.csv"');
  res.send(['email,joined', ...subs.map((s) => `"${s.email}","${s.createdAt.toISOString()}"`)].join('\n'));
});

// ---------- Admin access ----------
router.get('/admins', async (_req, res) => {
  const doc = await Content.findOne({ key: 'security' }).lean();
  res.json({ fromEnv: config.initialAdminEmails, approvedAdminEmails: doc?.data?.approvedAdminEmails || [] });
});

router.put('/admins', validate(z.object({ approvedAdminEmails: z.array(email()).max(20) })), async (req, res) => {
  const emails = [...new Set(req.body.approvedAdminEmails)];
  if (!emails.includes(req.user.email) && !config.initialAdminEmails.includes(req.user.email)) {
    return res.status(400).json({ error: 'You can’t remove your own admin access here.' });
  }
  await Content.findOneAndUpdate({ key: 'security' }, { key: 'security', data: { approvedAdminEmails: emails } }, { upsert: true });
  const allAdmins = [...new Set([...emails, ...config.initialAdminEmails])];
  await User.updateMany({ email: { $in: allAdmins } }, { role: 'admin' });
  await User.updateMany({ email: { $nin: allAdmins }, role: 'admin' }, { role: 'customer' });
  res.json({ approvedAdminEmails: emails });
});

module.exports = router;
