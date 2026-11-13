const express = require('express');
const config = require('../config');
const { Order, Product, Coupon, Review, Message, Subscriber, User, Content, GiftCard, EmailLog } = require('../models');
const { giftCardCode } = require('../lib/orders');
const { requireAdmin } = require('../middleware/auth');
const { validate, z, str, url, email } = require('../middleware/validate');
const { getContent, setContent, EDITABLE_KEYS, DEFAULTS } = require('../lib/content');
const { priceCommission, priceCart, PricingError } = require('../lib/pricing');
const { setStatus, customerView, pushHistory, newOrder } = require('../lib/orders');
const money = require('../lib/money');
const payments = require('../lib/payments');
const proofFiles = require('../lib/proof-files');
const cloudinary = require('../services/cloudinary');
const upi = require('../services/upi');
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
router.param('pid', (req, res, next, id) => {
  if (!objectId.safeParse(id).success) return res.status(404).json({ error: 'Not found.' });
  next();
});

// Errors thrown on purpose by the payment workflow carry their own status and message.
const handled = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.expose) return res.status(error.status || 400).json({ error: error.message });
    throw error;
  }
};

const STALE_APPROVAL_MS = 2 * 60 * 1000;

// ---------- Overview ----------
// What the to-do list counts. The same filters back the Orders list links, so "See them" always
// shows exactly the orders that were counted.
const OPEN_PROOF = { payments: { $not: { $elemMatch: { status: { $in: ['pending', 'approving'] } } } } };
const ORDER_FILTERS = {
  // The customer owes money now: a shop order not fully paid, a commission whose deposit isn't met,
  // or a finished commission (packing) whose balance is still due. Not while a proof is being checked.
  due: () => ({
    status: { $ne: 'cancelled' },
    total: { $gt: 0 },
    ...OPEN_PROOF,
    $or: [
      { type: 'shop', paymentStatus: { $in: ['unpaid', 'partially_paid'] } },
      { type: 'commission', 'commission.approvedAt': { $exists: true }, paymentStatus: { $in: ['unpaid', 'partially_paid'] } },
      { type: 'commission', status: 'packing', paymentStatus: 'deposit_paid' },
    ],
  }),
  // Paid enough for June's next step: start a paid shop order or a commission with its deposit,
  // or ship anything in packing that's fully paid.
  ready: () => ({
    $or: [
      { status: 'confirmed', $or: [{ type: 'shop', paymentStatus: { $in: ['paid', 'overpaid'] } }, { type: 'commission', paymentStatus: { $in: ['deposit_paid', 'paid', 'overpaid'] } }] },
      { status: 'packing', paymentStatus: { $in: ['paid', 'overpaid'] } },
    ],
  }),
  refund: () => ({ $or: [{ paymentStatus: 'overpaid' }, { status: 'cancelled', amountPaid: { $gt: 0 } }] }),
  check: () => ({ 'payments.status': 'pending' }),
  // Commissions not yet sent whose "needed by" date is past or within a week.
  deadline: () => ({ type: 'commission', status: { $nin: ['shipped', 'delivered', 'cancelled'] }, 'commission.deadline': { $lte: new Date(Date.now() + 7 * DAY) } }),
  // Work in the studio right now.
  studio: () => ({ status: { $in: ['confirmed', 'painting', 'packing'] } }),
};
const DAY = 24 * 60 * 60 * 1000;
const PREVIEW = 3; // rows shown under each to-do item
const ROW_FIELDS = 'number type name total amountPaid depositAmount status paymentStatus createdAt commission.tierTitle commission.deadline commission.approvedAt payments refunds';

// A to-do row: just enough to recognise the order at a glance.
const row = (o, extra = {}) => ({ id: String(o._id), number: o.number, name: o.name, type: o.type, ...extra });

// Money actually received in a window: approved payments by the day they were approved, minus refunds.
async function moneyIn(from, to) {
  const [paid, refunded] = await Promise.all([
    Order.aggregate([
      { $match: { 'payments.status': 'paid' } },
      { $unwind: '$payments' },
      { $match: { 'payments.status': 'paid' } },
      { $addFields: { when: { $ifNull: ['$payments.reviewedAt', '$payments.at'] } } },
      { $match: { when: { $gte: from, $lt: to } } },
      { $group: { _id: null, sum: { $sum: '$payments.amount' } } },
    ]),
    Order.aggregate([
      { $match: { 'refunds.at': { $gte: from, $lt: to } } },
      { $unwind: '$refunds' },
      { $match: { 'refunds.at': { $gte: from, $lt: to } } },
      { $group: { _id: null, sum: { $sum: '$refunds.amount' } } },
    ]),
  ]);
  return (paid[0]?.sum || 0) - (refunded[0]?.sum || 0);
}

// Payments in a given state, oldest first, with their order: the count and the first few rows.
async function paymentRows(match) {
  const [r] = await Order.aggregate([
    { $match: { payments: { $elemMatch: match } } },
    { $unwind: '$payments' },
    { $match: Object.fromEntries(Object.entries(match).map(([k, v]) => [`payments.${k}`, v])) },
    { $sort: { 'payments.submittedAt': 1 } },
    { $facet: {
      total: [{ $count: 'n' }],
      rows: [{ $limit: PREVIEW }, { $project: { number: 1, name: 1, type: 1, pid: '$payments._id', amount: '$payments.expectedAmount', kind: '$payments.kind', at: { $ifNull: ['$payments.submittedAt', '$payments.at'] } } }],
    } },
  ]);
  return {
    count: r.total[0]?.n || 0,
    oldest: r.rows[0]?.at || null,
    rows: r.rows.map((p) => row(p, { pid: String(p.pid), amount: p.amount, note: p.kind, at: p.at })),
  };
}

// Orders matching a filter: the count, the oldest, and the first few rows.
async function orderRows(filter, { sort = { createdAt: 1 }, map = (o) => row(o, { at: o.createdAt }) } = {}) {
  const [count, docs] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter).sort(sort).limit(PREVIEW).select(ROW_FIELDS).lean(),
  ]);
  return { count, rows: docs.map(map), oldest: docs[0]?.createdAt || null };
}

router.get('/stats', async (_req, res) => {
  const now = Date.now();
  const since = (days) => new Date(now - days * DAY);
  const [
    check, interrupted, quote, ready, deadline, dueDocs, refundCandidates,
    stock, unreadMessages, messageRows, pendingReviews, recent, inStudio, ordersThisWeek, orderCount, in30, inPrev30, site, launch,
  ] = await Promise.all([
    paymentRows({ status: 'pending' }),
    paymentRows({ status: 'approving', approvalStartedAt: { $lte: new Date(now - STALE_APPROVAL_MS) } }),
    orderRows({ type: 'commission', status: 'received' }, { map: (o) => row(o, { at: o.createdAt, note: o.commission?.tierTitle || '' }) }),
    orderRows(ORDER_FILTERS.ready(), { map: (o) => row(o, { at: o.createdAt, note: o.status === 'packing' ? 'Ship it' : o.type === 'commission' ? 'Start painting' : 'Paint and pack' }) }),
    orderRows(ORDER_FILTERS.deadline(), { sort: { 'commission.deadline': 1 }, map: (o) => row(o, { deadline: o.commission.deadline, note: STAGES[o.status]?.label || o.status }) }),
    // Every order owing money, so "owed to you" is exact. A small studio has only a few at a time.
    Order.find(ORDER_FILTERS.due()).sort({ createdAt: 1 }).select(ROW_FIELDS).lean(),
    Order.find(ORDER_FILTERS.refund()).sort({ createdAt: 1 }).select(ROW_FIELDS).lean(),
    Product.find({ status: 'live', kind: { $ne: 'giftcard' }, stock: { $lte: 1 } }).sort({ stock: 1 }).select('title stock slug').limit(10).lean(),
    Message.countDocuments({ handled: false, spam: { $ne: true } }),
    Message.find({ handled: false, spam: { $ne: true } }).sort({ createdAt: 1 }).limit(PREVIEW).select('name topic createdAt').lean(),
    Review.countDocuments({ approved: false }),
    Order.find().sort({ createdAt: -1 }).limit(6).select('number type name status total amountPaid createdAt paymentStatus').lean(),
    Order.aggregate([{ $match: ORDER_FILTERS.studio() }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Order.countDocuments({ createdAt: { $gte: since(7) } }),
    Order.estimatedDocumentCount(),
    moneyIn(since(30), new Date(now)),
    moneyIn(since(60), since(30)),
    getContent('site'),
    getContent('launch'),
  ]);

  const owed = (o) => money.amountDue(o)?.amount || 0;
  const refunds = refundCandidates.filter((o) => money.refundDue(o) > 0);
  const studio = Object.fromEntries(inStudio.map((g) => [g._id, g.n]));
  const upiReady = upi.isValidUpiId(site.upiId);

  res.json({
    // Headline numbers
    moneyIn30: in30,
    moneyInPrev30: inPrev30,
    owed: dueDocs.reduce((n, o) => n + owed(o), 0),
    inStudio: { commission: studio.commission || 0, shop: studio.shop || 0 },
    ordersThisWeek,
    orderCount,
    // Setup problems that stop customers paying
    upiMissing: !upiReady,
    checkoutPaused: require('../lib/email-code').codeMode() === 'unavailable',
    // To-do counts. Each link opens exactly the orders counted here.
    paymentsToCheck: check.count,
    oldestCheckAt: check.oldest,
    interruptedApprovals: interrupted.count,
    refundsDue: refunds.length,
    refundsDueAmount: refunds.reduce((n, o) => n + money.refundDue(o), 0),
    deadlines: deadline.count,
    overdue: deadline.rows.filter((r) => new Date(r.deadline).getTime() < now).length,
    awaitingQuote: quote.count,
    oldestQuoteAt: quote.oldest,
    toShip: ready.count,
    awaitingPayment: dueDocs.length,
    oldestDueAt: dueDocs[0]?.createdAt || null,
    staleDue: dueDocs.filter((o) => now - new Date(o.createdAt).getTime() > 7 * DAY).length,
    soldOut: stock.filter((p) => p.stock <= 0).length,
    lowStock: stock,
    unreadMessages,
    pendingReviews,
    // The first few rows under each to-do item
    previews: {
      check: check.rows,
      interrupted: interrupted.rows,
      refund: refunds.slice(0, PREVIEW).map((o) => row(o, { amount: money.refundDue(o), note: o.status === 'cancelled' ? 'cancelled' : 'overpaid' })),
      deadline: deadline.rows,
      quote: quote.rows,
      ready: ready.rows,
      due: dueDocs.slice(0, PREVIEW).map((o) => row(o, { amount: owed(o), at: o.createdAt, note: money.amountDue(o)?.kind || '' })),
      messages: messageRows.map((m) => ({ id: String(m._id), name: m.name, note: m.topic || '', at: m.createdAt })),
    },
    recent: recent.map((o) => ({ ...o, statusLabel: STAGES[o.status]?.label || o.status })),
    checklist: [
      { key: 'payments', label: 'Your UPI ID added for payments', done: upiReady, hint: 'Customers pay this UPI ID and send you the UTR and a screenshot. Add it in Site content → Money & delivery.' },
      { key: 'email', label: `Emails connected${config.emailProvider ? ` (${config.emailProvider === 'gmail' ? 'Gmail' : config.emailProvider})` : ''}`, done: config.features.email, hint: 'Until then no emails go out (enquiries are still saved in Messages). Set up: handover guide, "Emails: Gmail" — free, no domain needed.' },
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
  // Payment filters from the to-do list. $and keeps them apart from the search's $or.
  if (Object.hasOwn(ORDER_FILTERS, req.query.payment)) filter.$and = [ORDER_FILTERS[req.query.payment]()];
  if (req.query.q) {
    const q = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
    filter.$or = [{ number: q }, { name: q }, { email: q }, { phone: q }, { 'payments.utr': q }];
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
      payments: order.payments.map((p) => ({ ...p.toObject(), hasProof: Boolean(p.proofId), proofId: undefined, interrupted: p.status === 'approving' && p.approvalStartedAt && Date.now() - p.approvalStartedAt.getTime() > STALE_APPROVAL_MS })),
      refunds: order.refunds,
      refundDue: money.refundDue(order),
      overpaidBy: money.overpaidBy(order),
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
  if (money.openPayment(order)) return res.status(409).json({ error: 'A payment for this order is waiting for your check. Approve or reject it first.' });
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
  order.commission.approvedAt = undefined; // a new price needs the customer's approval again
  order.status = 'quoted';
  pushHistory(order, 'quoted');
  await order.save();
  if (req.body.notify) await mail.send({ to: order.email, ...mail.templates.quoteReady(order), key: `quote:${order._id}:${order.history.length}`, kind: 'quote' });
  res.json({ ok: true, total: order.total, depositAmount: order.depositAmount });
});

router.post('/orders/:id/payments', validate(z.object({
  kind: z.enum(['full', 'deposit', 'balance']),
  amount: z.coerce.number().int().min(1).max(1_000_000),
  note: str(300).optional().default('Recorded manually'),
})), handled(async (req, res) => {
  await payments.recordManualPayment(req.params.id, { kind: req.body.kind, amount: req.body.amount, note: req.body.note, admin: req.user.email });
  res.json({ ok: true });
}));

// ---------- UPI payment review ----------
const bankCheck = z.object({
  date: str(40).optional().default(''),
  sender: str(120).optional().default(''),
  utrMatched: z.boolean().optional().default(false),
  amountConfirmed: z.boolean().optional().default(false),
}).optional().prefault({});

// The review queue: every payment with proof, oldest waiting first.
router.get('/payments', async (req, res) => {
  const status = ['pending', 'approving', 'paid', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const kind = ['full', 'deposit', 'balance'].includes(req.query.kind) ? req.query.kind : '';
  const match = { 'payments.status': status, 'payments.method': { $in: ['upi', 'manual'] } };
  if (kind) match['payments.kind'] = kind;
  const q = String(req.query.q || '').trim().slice(0, 60);
  const pre = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    pre.$or = [{ number: rx }, { name: rx }, { email: rx }, { 'payments.utr': rx }];
  }
  const rows = await Order.aggregate([
    { $match: { ...pre, 'payments.status': status } },
    { $unwind: '$payments' },
    { $match: match },
    ...(q ? [{ $match: { $or: [{ number: new RegExp(escapeRegex(q), 'i') }, { name: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }, { 'payments.utr': new RegExp(escapeRegex(q), 'i') }] } }] : []),
    { $sort: status === 'pending' || status === 'approving' ? { 'payments.submittedAt': 1 } : { 'payments.reviewedAt': -1 } },
    { $limit: 200 },
    { $project: { number: 1, name: 1, email: 1, type: 1, total: 1, amountPaid: 1, status: 1, items: 1, payment: '$payments' } },
  ]);
  const productIds = [...new Set(rows.flatMap((r) => (r.items || []).map((i) => String(i.productId))).filter(Boolean))];
  const stock = new Map((await Product.find({ _id: { $in: productIds } }).select('stock').lean()).map((p) => [String(p._id), p.stock]));
  res.json({
    items: rows.map((r) => {
      const p = r.payment;
      const lowStock = r.type === 'shop' && p.status === 'pending' && (r.items || []).some((i) => i.kind !== 'giftcard' && (stock.get(String(i.productId)) ?? 0) < i.qty);
      return {
        orderId: r._id, number: r.number, name: r.name, email: r.email, type: r.type, total: r.total, amountPaid: r.amountPaid, orderStatus: r.status,
        paymentId: p._id, kind: p.kind, status: p.status, method: p.method, utr: p.utr, expectedAmount: p.expectedAmount, amount: p.amount,
        submittedAt: p.submittedAt, reviewedAt: p.reviewedAt, reviewedBy: p.reviewedBy, rejectionReason: p.rejectionReason, bankCheck: p.bankCheck,
        hasProof: Boolean(p.proofId),
        mismatch: p.status === 'paid' && p.expectedAmount && p.amount !== p.expectedAmount,
        interrupted: p.status === 'approving' && p.approvalStartedAt && Date.now() - new Date(p.approvalStartedAt).getTime() > STALE_APPROVAL_MS,
        lowStock,
      };
    }),
  });
});

// One payment with everything needed to review it next to the screenshot.
router.get('/orders/:id/payments/:pid', async (req, res) => {
  const order = await Order.findById(req.params.id);
  const p = order?.payments.id(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Payment not found.' });
  const stock = order.type === 'shop'
    ? await Promise.all(order.items.filter((i) => i.kind !== 'giftcard').map(async (i) => ({ title: i.title, qty: i.qty, inStock: (await Product.findById(i.productId).select('stock').lean())?.stock ?? 0 })))
    : [];
  const others = order.payments.filter((x) => String(x._id) !== String(p._id)).map((x) => ({ id: x._id, kind: x.kind, status: x.status, amount: x.amount, expectedAmount: x.expectedAmount, utr: x.utr, at: x.reviewedAt || x.submittedAt || x.at, reason: x.rejectionReason, by: x.reviewedBy }));
  res.json({
    order: { id: order._id, number: order.number, type: order.type, name: order.name, email: order.email, phone: order.phone, total: order.total, amountPaid: order.amountPaid, depositAmount: order.depositAmount, status: order.status, paymentStatus: order.paymentStatus, items: order.items, commission: order.commission ? { tierTitle: order.commission.tierTitle } : null },
    payment: { ...p.toObject(), proofId: undefined, hasProof: Boolean(p.proofId), interrupted: p.status === 'approving' && p.approvalStartedAt && Date.now() - p.approvalStartedAt.getTime() > STALE_APPROVAL_MS },
    others,
    stock,
  });
});

// The screenshot itself. Streamed through the server so it never has a public address.
router.get('/orders/:id/payments/:pid/proof', async (req, res) => {
  const order = await Order.findById(req.params.id).select('payments');
  const p = order?.payments.id(req.params.pid);
  if (!p?.proofId) return res.status(404).json({ error: 'No screenshot for this payment.' });
  const file = p.proofProvider === 'cloudinary' ? await cloudinary.fetchPrivateImage(p.proofId, 'jpg') : await proofFiles.readLocal(p.proofId);
  if (!file) return res.status(404).json({ error: 'That screenshot is no longer stored.' });
  res.set('Content-Type', /^image\/(jpeg|png|webp)$/.test(file.contentType) ? file.contentType : 'image/jpeg');
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(file.buffer);
});

router.post('/orders/:id/payments/:pid/approve', validate(z.object({
  amount: z.coerce.number().int().min(1).max(10_000_000),
  bankCheck,
})), handled(async (req, res) => {
  const result = await payments.approvePayment(req.params.id, req.params.pid, { amount: req.body.amount, bankCheck: req.body.bankCheck, admin: req.user.email });
  res.json({ ok: true, paymentStatus: result.order.paymentStatus, due: money.amountDue(result.order) });
}));

router.post('/orders/:id/payments/:pid/reject', validate(z.object({ reason: str(300).min(3, 'Choose or type a reason. The customer will see it.') })), handled(async (req, res) => {
  await payments.rejectPayment(req.params.id, req.params.pid, { reason: req.body.reason, admin: req.user.email });
  res.json({ ok: true });
}));

// Finishes an approval that was interrupted (a crash or timeout). Never repeats anything.
router.post('/orders/:id/payments/:pid/finish', handled(async (req, res) => {
  const result = await payments.finishApproval(req.params.id, req.params.pid);
  res.json({ ok: true, already: result.already, paymentStatus: result.order.paymentStatus });
}));

router.post('/orders/:id/refunds', validate(z.object({
  amount: z.coerce.number().int().min(1).max(10_000_000),
  note: str(300).optional().default(''),
})), handled(async (req, res) => {
  const order = await payments.recordRefund(req.params.id, { amount: req.body.amount, note: req.body.note, admin: req.user.email });
  res.json({ ok: true, paymentStatus: order.paymentStatus, amountPaid: order.amountPaid });
}));

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
  address: z.object({ name: optStr(80), phone: optStr(20), line1: optStr(200), line2: optStr(200), city: optStr(80), state: optStr(80), pincode: optStr(10) }).optional().prefault({}),
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
    await payments.recordManualPayment(order._id, { kind: b.paid === 'full' ? 'full' : 'deposit', amount, note: b.paymentNote || `Paid on ${from}`, admin: req.user.email });
  } else if (b.notify) {
    if (order.type === 'shop') await mail.send({ to: order.email, ...mail.templates.shopOrderPlaced(order), key: `order-placed:${order._id}`, kind: 'order' });
    else if (order.status === 'quoted') await mail.send({ to: order.email, ...mail.templates.quoteReady(order), key: `quote:${order._id}:${order.history.length}`, kind: 'quote' });
    else await mail.send({ to: order.email, ...mail.templates.commissionReceived(order), key: `commission-received:${order._id}`, kind: 'commission' });
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
  details: z.object({ size: str(120).optional().default(''), material: str(200).optional().default(''), care: str(500).optional().default('') }).optional().prefault({}),
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
    // Send while there's time in this request; the rest are queued and go out with the daily cron.
    const deadline = Date.now() + 15_000;
    for (const sub of waiting) {
      await mail.send({ to: sub.email, ...mail.templates.restock(sub.email, product), key: `restock:${sub._id}`, kind: 'restock', defer: Date.now() > deadline });
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
  if (key === 'site' && data.upiId !== undefined) {
    data.upiId = String(data.upiId || '').trim();
    if (data.upiId && !upi.isValidUpiId(data.upiId)) return res.status(400).json({ error: 'That UPI ID doesn’t look right. It should look like name@bank, for example june@okhdfc.' });
    data.upiName = String(data.upiName || '').trim().slice(0, 60);
  }
  res.json({ key, data: await setContent(key, data) });
});

// ---------- Messages & subscribers ----------
router.get('/messages', async (_req, res) => res.json({ items: await Message.find().sort({ handled: 1, createdAt: -1 }).limit(200).lean() }));
router.patch('/messages/:id', validate(z.object({ handled: z.boolean() })), async (req, res) => {
  await Message.updateOne({ _id: req.params.id }, { handled: req.body.handled });
  res.json({ ok: true });
});

// ---------- Email log ----------
router.get('/emails', async (_req, res) => {
  const items = await EmailLog.find().sort({ createdAt: -1 }).limit(100)
    .select('kind to subject status attempts lastError createdAt sentAt').lean();
  res.json({ items, provider: config.emailProvider, inbox: mail.adminInbox(), sender: config.email.gmailUser || config.email.smtpUser || '' });
});

router.post('/emails/:id/retry', async (req, res) => {
  const r = await mail.retry(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  if (!r.ok) return res.status(502).json({ error: r.error || 'Still not sending. Check the email settings.' });
  res.json({ ok: true });
});

// Checks the Gmail login, then sends a sample to the studio inbox.
router.post('/emails/test', async (req, res) => {
  const check = await mail.verify();
  if (!check.ok) return res.status(502).json({ error: `Email login failed: ${check.error}` });
  const to = mail.adminInbox();
  const r = await mail.send({ to, kind: 'test', ...mail.templates.adminAlert('Test email', ['If you can read this, the site can send email.', `Sent from ${config.appUrl} on ${new Date().toUTCString()}.`], `${config.appUrl}/admin`) });
  if (!r.ok) return res.status(502).json({ error: r.error || 'Send failed.' });
  res.json({ ok: true, to });
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
