const express = require('express');
const config = require('../config');
const { Product, Review, Message, Subscriber, CartDraft } = require('../models');
const { randomToken, sha256 } = require('../lib/util');

// User text goes into a regex for search, so escape every special character.
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const { getContent } = require('../lib/content');
const { priceCart } = require('../lib/pricing');
const { validate, z, str, email, phone } = require('../middleware/validate');
const { limiters } = require('../middleware/security');
const mail = require('../services/email');

const router = express.Router();

async function reviewSummary() {
  const [agg] = await Review.aggregate([
    { $match: { approved: true } },
    { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } },
  ]);
  return { count: agg?.count || 0, average: agg ? Math.round(agg.avg * 10) / 10 : 0 };
}

// One request that gives every page what it needs for shared UI.
router.get('/bootstrap', async (_req, res) => {
  const [site, tiers, gifting] = await Promise.all([getContent('site'), getContent('tiers'), getContent('gifting')]);
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    site: {
      announcement: site.announcement,
      heroEyebrow: site.heroEyebrow,
      heroTitle: site.heroTitle,
      heroSubtitle: site.heroSubtitle,
      heroNote: site.heroNote,
      marquee: site.marquee,
      trustLine: site.trustLine,
      meetJuneTitle: site.meetJuneTitle,
      meetJuneBody: site.meetJuneBody,
      instagram: site.instagram,
      whatsapp: site.whatsapp,
      // The old placeholder address (never a real inbox) falls back to the configured Gmail.
      supportEmail: (site.supportEmail && !/@artorabyjune\.com$/i.test(site.supportEmail)) ? site.supportEmail : config.brand.supportEmail,
      replyTime: site.replyTime,
      depositPercent: site.depositPercent,
      shippingFlat: site.shippingFlat,
      freeShippingAbove: site.freeShippingAbove,
      giftWrapFee: site.giftWrapFee,
      dispatchDays: site.dispatchDays,
      deliveryDays: site.deliveryDays,
      upiId: config.features.razorpay ? '' : site.upiId,
      upiName: site.upiName,
    },
    tiers,
    gifting,
    reviews: await reviewSummary(),
    features: {
      payments: config.features.razorpay ? 'razorpay' : 'manual',
      google: config.features.google,
      razorpayKey: config.features.razorpay ? config.razorpay.keyId : '',
    },
  });
});

router.get('/faqs', async (_req, res) => {
  res.json({ items: await getContent('faqs') });
});

router.get('/about', async (_req, res) => {
  res.json(await getContent('about'));
});

router.get('/portfolio', async (req, res) => {
  const items = await getContent('portfolio');
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
  res.json({ items: q ? items.filter((i) => [i.title, i.memory, i.category].some((v) => String(v || '').toLowerCase().includes(q))) : items });
});

router.get('/portfolio/:slug', async (req, res) => {
  const items = await getContent('portfolio');
  const item = items.find((i) => i.slug === req.params.slug);
  if (!item) return res.status(404).json({ error: 'Story not found.' });
  res.json({ item, more: items.filter((i) => i.slug !== item.slug).slice(0, 3) });
});

router.get('/reviews', async (req, res) => {
  const limit = Math.min(30, Number(req.query.limit) || 12);
  const items = await Review.find({ approved: true }).sort({ featured: -1, createdAt: -1 }).limit(limit).lean();
  res.json({
    items: items.map((r) => ({ id: r._id, name: r.name, city: r.city, rating: r.rating, text: r.text, photo: r.photo || '' })),
    summary: await reviewSummary(),
  });
});

router.get('/products', async (req, res) => {
  const filter = { status: 'live' };
  if (req.query.tag) filter.tags = String(req.query.tag);
  if (req.query.colour) filter.colour = String(req.query.colour);
  if (req.query.featured === '1') filter.featured = true;
  if (req.query.inStock === '1') filter.stock = { $gt: 0 };
  if (req.query.kind) filter.kind = String(req.query.kind) === 'giftcard' ? 'giftcard' : { $ne: 'giftcard' };
  if (req.query.ids) filter._id = { $in: String(req.query.ids).split(',').filter((id) => /^[a-f0-9]{24}$/i.test(id)).slice(0, 60) };
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: rx }, { summary: rx }, { tags: rx }, { colour: rx }];
  }
  const sorts = {
    featured: { featured: -1, sortOrder: 1, createdAt: -1 },
    new: { createdAt: -1 },
    'price-asc': { price: 1 },
    'price-desc': { price: -1 },
  };
  const sort = sorts[req.query.sort] || sorts.featured;
  const limit = Math.min(60, Number(req.query.limit) || 60);
  const [products, allTags] = await Promise.all([
    Product.find(filter).sort(sort).limit(limit),
    Product.distinct('tags', { status: 'live' }),
  ]);
  res.json({ items: products.map((p) => p.toPublic()), tags: allTags.sort() });
});

router.get('/products/:slug', async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, status: 'live' });
  if (!product) return res.status(404).json({ error: 'That tote isn’t in the studio any more.' });
  const related = await Product.find({
    status: 'live',
    _id: { $ne: product._id },
    ...(product.tags.length ? { tags: { $in: product.tags } } : {}),
  }).sort({ featured: -1, createdAt: -1 }).limit(4);
  res.json({ item: product.toPublic(), related: related.map((p) => p.toPublic()) });
});

const cartItems = z.array(z.object({
  productId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid item.'),
  qty: z.coerce.number().int().min(1).max(10),
})).max(30);

router.post('/cart/quote', validate(z.object({
  items: cartItems,
  couponCode: str(40).optional().default(''),
  giftCode: str(40).optional().default(''),
  giftWrap: z.boolean().optional().default(false),
})), async (req, res) => {
  if (!req.body.items.length) return res.json({ lines: [], problems: [], subtotal: 0, discount: 0, shippingFee: 0, giftWrapFee: 0, total: 0 });
  res.json(await priceCart(req.body));
});

// Remember a bag when someone types their email at checkout (for one reminder if they don't finish).
router.post('/cart/draft', limiters.write, validate(z.object({ email: email(), items: cartItems.min(1) })), async (req, res) => {
  const existing = await CartDraft.findOne({ email: req.body.email, orderPlacedAt: { $exists: false }, remindedAt: { $exists: false } });
  if (existing) {
    existing.items = req.body.items;
    await existing.save();
    return res.json({ ok: true });
  }
  await CartDraft.create({ email: req.body.email, items: req.body.items, token: randomToken(18) });
  res.status(201).json({ ok: true });
});

router.get('/cart/draft/:token', async (req, res) => {
  const draft = await CartDraft.findOne({ token: String(req.params.token) });
  if (!draft) return res.status(404).json({ error: 'That bag link has expired.' });
  const products = await Product.find({ _id: { $in: draft.items.map((i) => i.productId) }, status: 'live' });
  res.json({ items: draft.items.map((i) => ({ qty: i.qty, product: products.find((p) => String(p._id) === String(i.productId))?.toPublic() })).filter((i) => i.product) });
});

// One-click unsubscribe (RFC 8058): Gmail and others POST here from their own "Unsubscribe" button.
router.post('/cart/unsubscribe/:token', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
  const draft = await CartDraft.findOne({ token: String(req.params.token) });
  if (draft) await CartDraft.updateMany({ email: draft.email }, { $set: { unsubscribed: true } });
  res.json({ ok: true });
});

router.get('/cart/unsubscribe/:token', async (req, res) => {
  const draft = await CartDraft.findOne({ token: String(req.params.token) });
  if (draft) await CartDraft.updateMany({ email: draft.email }, { $set: { unsubscribed: true } });
  res.type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Done · Artora by June</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#ECE4D2;font-family:Georgia,serif;color:#221D19;text-align:center;padding:24px"><div><p style="font-size:22px">Done — no more reminders.</p><p><a href="/" style="color:#C1443C">Back to the studio</a></p></div></body>');
});

// Contact form → studio inbox (Reply-To: customer) + an acknowledgement to the customer.
const HOUR = 60 * 60 * 1000;
router.post('/contact', limiters.write, validate(z.object({
  name: str(80).min(1, 'Please tell us your name.'),
  email: email(),
  phone: phone().optional().default(''),
  topic: str(60).optional().default('General'),
  message: str(3000).min(5, 'Please write a little more.'),
  website: z.string().max(0, 'Spam detected.').optional(), // honeypot
  clientId: z.string().regex(/^[\w-]{8,64}$/).optional(),
  startedAt: z.coerce.number().int().optional(),
})), async (req, res) => {
  const { website, clientId, startedAt, ...data } = req.body;
  const ipHash = sha256(`${req.ip}|${config.jwtSecret}`).slice(0, 32);
  const now = Date.now();

  // Same submission again (double tap, slow network retry): answer as before, send nothing.
  if (clientId && await Message.exists({ clientId })) return res.status(201).json({ ok: true, ack: true });
  const twin = await Message.findOne({ email: data.email, message: data.message, createdAt: { $gte: new Date(now - 10 * 60 * 1000) } }).lean();
  if (twin) return res.status(201).json({ ok: true, ack: twin.ackEmail === 'sent' });

  // Abuse limits that hold across serverless instances (the in-memory limiter does not).
  if (await Message.countDocuments({ ipHash, createdAt: { $gte: new Date(now - HOUR) } }) >= 5) {
    return res.status(429).json({ error: 'You’ve sent a few notes already. Please try again in an hour, or message June on Instagram.' });
  }
  // Bots fill the form instantly or stuff it with links. Store quietly, send no emails.
  const tooFast = startedAt && now - startedAt < 3000 && now - startedAt >= 0;
  const linky = (data.message.match(/https?:\/\/|www\./gi) || []).length > 3;
  const spam = Boolean(tooFast || linky);

  let msg;
  try {
    msg = await Message.create({ ...data, clientId, ipHash, spam });
  } catch (error) {
    if (error?.code === 11000) return res.status(201).json({ ok: true, ack: true });
    throw error;
  }
  if (spam) return res.status(201).json({ ok: true, ack: false });

  // At most 3 acknowledgements a day to one address, so the form can't be used to spam strangers.
  const recent = await Message.countDocuments({ email: data.email, ackEmail: 'sent', createdAt: { $gte: new Date(now - 24 * HOUR) } });
  const site = await getContent('site');
  const m = { ...msg.toObject(), replyTime: site.replyTime };
  const [owner, ack] = await Promise.all([
    mail.send({ to: mail.adminInbox(), ...mail.templates.enquiryForOwner(m), replyTo: `"${data.name.replace(/["<>]/g, '')}" <${data.email}>`, key: `enquiry-owner:${msg._id}`, kind: 'enquiry' }),
    recent < 3
      ? mail.send({ to: data.email, ...mail.templates.enquiryReceived(m), key: `enquiry-ack:${msg._id}`, kind: 'enquiry-ack' })
      : Promise.resolve({ skipped: true }),
  ]);
  const status = (r) => (r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed');
  await Message.updateOne({ _id: msg._id }, { $set: { ownerEmail: status(owner), ackEmail: status(ack) } });
  // The note is saved either way; June sees it in Admin → Messages even if an email failed.
  res.status(201).json({ ok: true, ack: Boolean(ack.ok) });
});

router.post('/subscribe', limiters.write, validate(z.object({
  email: email(),
  kind: z.enum(['newsletter', 'restock']).default('newsletter'),
  productId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
})), async (req, res) => {
  const { email: mailAddr, kind, productId } = req.body;
  let productTitle;
  if (kind === 'restock') {
    const product = productId && await Product.findById(productId);
    if (!product) return res.status(400).json({ error: 'Invalid product.' });
    productTitle = product.title;
  }
  await Subscriber.updateOne(
    { email: mailAddr, kind, productId: kind === 'restock' ? productId : undefined },
    { $setOnInsert: { email: mailAddr, kind, productId: kind === 'restock' ? productId : undefined, productTitle } },
    { upsert: true },
  );
  res.status(201).json({ ok: true });
});

module.exports = router;
