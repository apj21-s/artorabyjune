require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

const {
  MONGODB_URI = 'mongodb://127.0.0.1:27017/artora_by_june',
  JWT_SECRET = 'replace-me',
  COOKIE_NAME = 'artora_session',
  APP_URL = 'http://localhost:3000',
  PORT = 3000,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL = 'orders@artorabyjune.com',
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI = `${APP_URL}/api/auth/google/callback`,
  INITIAL_ADMIN_EMAILS = '',
} = process.env;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
}

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..')));

const DEFAULT_SITE_CONTENT = {
  heroTitle: 'Some moments deserve more than a photograph.',
  heroSubtitle: 'Choose a memory, and June turns it into a one-of-one canvas story.',
  homepageWording: 'Every tote carries a story.',
  pricingCopy: 'Commission tiers stay simple and premium.',
  storiesCopy: 'Stories, gallery images, and canvas artwork live in the database.',
  opsCopy: 'Testimonials, FAQs, shipping timelines, featured products, coupons, and statuses are editable here.',
  featuredProducts: 'Mini, Classic tote, and Big canvas stories are ready to customize.',
};

const DEFAULT_TIMELINE = [
  { label: 'June has received your story', note: 'June has your story safely in the studio.', active: true },
  { label: 'June is sketching your idea', note: 'June is preparing your composition.' },
  { label: 'June is painting your memory', note: 'June has brushes on your canvas.' },
  { label: 'June is packaging your story', note: 'Your tote is being wrapped with care.' },
  { label: 'Your story is on its way', note: 'Your finished story is heading to you now.' },
  { label: 'Your story has arrived', note: 'Your story has arrived home.' },
];

const DEFAULT_FAQS = [
  { question: 'How long does a story take?', answer: 'Most custom stories take between 5 and 10 days depending on complexity.' },
  { question: 'Can I save a memory before ordering?', answer: 'Yes. Customers can save memories to their dashboard and reuse them later.' },
  { question: 'Do you ship updates?', answer: 'Yes. Each stage update can trigger an email and dashboard timeline update.' },
];

const DEFAULT_TESTIMONIALS = [
  { name: 'Ananya', quote: 'It felt like commissioning art, not buying a bag.' },
  { name: 'Rehan', quote: 'The sketch preview made the whole thing feel personal.' },
];

const DEFAULT_GALLERY = [
  { title: 'Movie night moments', description: 'A still from the film you quote too much.' },
  { title: 'Couple portraits', description: 'Two people, one sunset, your own words underneath.' },
  { title: 'Pet portraits', description: 'The one who is never leaving your side anyway.' },
];

const DEFAULT_STORIES = [
  { title: 'Movie night tote', summary: 'A soft, cinematic memory with a quiet premium finish.', price: '899', image: '', featured: true },
  { title: 'Birthday postcard', summary: 'A brighter story with ribbon-like color and a personal line.', price: '1099', image: '', featured: false },
];

const DEFAULT_COUPONS = [
  { code: 'BEGIN10', kind: 'percent', value: '10', expiresAt: '', active: true },
  { code: 'STORY50', kind: 'flat', value: '50', expiresAt: '', active: false },
];

const DEFAULT_ORDER_STATUSES = [
  { label: 'June has received your story', description: 'June has your memory and is preparing the canvas.', etaDays: '0', active: true },
  { label: 'June is sketching your idea', description: 'June is planning the composition.', etaDays: '1', active: true },
  { label: 'June is painting your memory', description: 'June is layering colour by hand.', etaDays: '3', active: true },
  { label: 'June is packaging your story', description: 'Your tote is being wrapped for its journey.', etaDays: '5', active: true },
  { label: 'Your story is on its way', description: 'Your finished tote is travelling to you.', etaDays: '6', active: true },
  { label: 'Your story has arrived', description: 'Your story is home.', etaDays: '7', active: true },
];

const defaultAdminEmails = INITIAL_ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, index: true },
  passwordHash: String,
  role: { type: String, default: 'customer', enum: ['customer', 'admin'] },
  profile: {
    displayName: String,
    pronouns: String,
    bio: String,
  },
  favorites: [{
    title: String,
    subtitle: String,
    tag: String,
    image: String,
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

const ContentSchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

const OrderSchema = new mongoose.Schema({
  storyNumber: { type: String, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  email: String,
  name: String,
  contact: String,
  story: String,
  referenceImages: { type: [String], default: [] },
  title: String,
  description: String,
  status: { type: String, default: 'June has received your story' },
  paymentStatus: { type: String, default: 'pending' },
  expectedDelivery: Date,
  price: Number,
  favoriteSnapshot: { type: Object, default: {} },
  timeline: { type: Array, default: () => DEFAULT_TIMELINE },
  shippingUpdates: { type: Array, default: [] },
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Content = mongoose.model('Content', ContentSchema);
const Order = mongoose.model('Order', OrderSchema);

async function seedDefaults() {
  const defaults = [
    { key: 'siteContent', data: DEFAULT_SITE_CONTENT },
    { key: 'gallery', data: DEFAULT_GALLERY },
    { key: 'testimonials', data: DEFAULT_TESTIMONIALS },
    { key: 'faqs', data: DEFAULT_FAQS },
    { key: 'stories', data: DEFAULT_STORIES },
    { key: 'coupons', data: DEFAULT_COUPONS },
    { key: 'orderStatuses', data: DEFAULT_ORDER_STATUSES },
    { key: 'shipping', data: { timeline: DEFAULT_TIMELINE } },
    { key: 'security', data: { approvedAdminEmails: defaultAdminEmails } },
  ];

  for (const item of defaults) {
    await Content.findOneAndUpdate({ key: item.key }, { $setOnInsert: item }, { upsert: true, new: true });
  }
}

function signSession(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role || 'customer' },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function getCurrentUser(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = bearer || req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return User.findById(payload.sub);
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const user = await getCurrentUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  req.user = user;
  next();
}

async function getApprovedAdminEmails() {
  const security = await Content.findOne({ key: 'security' }).lean();
  const emails = new Set(defaultAdminEmails);
  (security?.data?.approvedAdminEmails || []).forEach((email) => emails.add(String(email).toLowerCase()));
  return emails;
}

async function syncRole(user) {
  const approved = await getApprovedAdminEmails();
  if (approved.has(user.email.toLowerCase())) {
    user.role = 'admin';
    await user.save();
  }
  return user;
}

async function sendTransactionalEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log('[email]', { to, subject });
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });
}

function emailTemplate(title, body) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#221D19;background:#E8E1D0;padding:24px">
      <div style="max-width:640px;margin:0 auto;background:#FBF8F1;border-radius:24px;padding:28px;border:1px solid rgba(34,29,25,.08)">
        <h1 style="margin:0 0 12px;font-size:28px;">${title}</h1>
        <p style="margin:0;">${body}</p>
      </div>
    </div>
  `;
}

function orderSubject(status) {
  const map = {
    'June has received your story': 'June has received your story',
    'Payment confirmed': 'Payment confirmed for your story',
    'June is sketching your idea': 'June is sketching your idea',
    'June is painting your memory': 'June is painting your memory',
    'June is packaging your story': 'June is packaging your story',
    'Your story is on its way': 'Your story is on its way',
    'Your story has arrived': 'Your story has arrived',
  };
  return map[status] || `Update on your story: ${status}`;
}

function orderEmailBody(order, status) {
  const map = {
    'June has received your story': 'June has received your memory and is preparing your canvas.',
    'Payment confirmed': 'Your payment has been confirmed and June can now move forward.',
    'June is sketching your idea': 'June is turning your note into a composition.',
    'June is painting your memory': 'June is painting your canvas by hand.',
    'June is packaging your story': 'June is wrapping your tote for its journey.',
    'Your story is on its way': 'Your finished story is travelling to you now.',
    'Your story has arrived': 'Your story has arrived home.',
  };
  return map[status] || `Your order status is now ${status}.`;
}

async function sendOrderStatusEmail(order, status) {
  const to = order.email;
  if (!to) return;
  const subject = orderSubject(status);
  const body = orderEmailBody(order, status);
  await sendTransactionalEmail({
    to,
    subject,
    html: emailTemplate(subject, body),
  });
}

function normalizeContentDoc(doc, fallback = {}) {
  return {
    ...(fallback || {}),
    ...((doc && doc.data) || {}),
  };
}

async function getContent(key, fallback = {}) {
  const doc = await Content.findOne({ key }).lean();
  return normalizeContentDoc(doc, fallback);
}

async function getPublicContent() {
  const [siteContent, gallery, testimonials, faqs, shipping, stories, coupons, orderStatuses] = await Promise.all([
    getContent('siteContent', DEFAULT_SITE_CONTENT),
    getContent('gallery', DEFAULT_GALLERY),
    getContent('testimonials', DEFAULT_TESTIMONIALS),
    getContent('faqs', DEFAULT_FAQS),
    getContent('shipping', { timeline: DEFAULT_TIMELINE }),
    getContent('stories', DEFAULT_STORIES),
    getContent('coupons', DEFAULT_COUPONS),
    getContent('orderStatuses', DEFAULT_ORDER_STATUSES),
  ]);

  return {
    ...siteContent,
    gallery,
    testimonials,
    faqs,
    shipping,
    stories,
    coupons,
    orderStatuses,
  };
}

app.get('/api/public/site-content', async (_req, res) => {
  res.json(await getPublicContent());
});

app.get('/api/public/gallery', async (_req, res) => {
  const content = await getContent('gallery', DEFAULT_GALLERY);
  res.json({ items: content });
});

app.get('/api/public/testimonials', async (_req, res) => {
  const content = await getContent('testimonials', DEFAULT_TESTIMONIALS);
  res.json({ items: content });
});

app.get('/api/public/faqs', async (_req, res) => {
  const content = await getContent('faqs', DEFAULT_FAQS);
  res.json({ items: content });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ error: 'Account already exists.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    email: email.toLowerCase(),
    name: name || email.split('@')[0],
    passwordHash,
    profile: { displayName: name || email.split('@')[0] },
  });

  await syncRole(user);
  const token = signSession(user);
  setSessionCookie(res, token);
  res.json({ token, role: user.role, user: { id: user._id, email: user.email, name: user.name } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase() });
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password || '', user.passwordHash || '');
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  await syncRole(user);
  const token = signSession(user);
  setSessionCookie(res, token);
  res.json({ token, role: user.role, user: { id: user._id, email: user.email, name: user.name } });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  await syncRole(user);
  const token = signSession(user);
  setSessionCookie(res, token);
  res.json({
    token,
    role: user.role,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      profile: user.profile || {},
    },
  });
});

app.get('/api/auth/google/start', async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(501).send('Google OAuth is not configured yet.');
  }
  const returnTo = String(req.query.returnTo || APP_URL);
  const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing OAuth code.');
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(501).send('Google OAuth is not configured.');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) return res.status(401).send('Google token exchange failed.');
  const tokenJson = await tokenRes.json();
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userInfoRes.ok) return res.status(401).send('Google profile fetch failed.');
  const profile = await userInfoRes.json();

  let user = await User.findOne({ email: profile.email.toLowerCase() });
  if (!user) {
    user = await User.create({
      email: profile.email.toLowerCase(),
      name: profile.name || profile.given_name || profile.email.split('@')[0],
      profile: { displayName: profile.name || profile.email.split('@')[0] },
    });
  }
  await syncRole(user);
  const token = signSession(user);
  setSessionCookie(res, token);
  const returnTo = state ? JSON.parse(Buffer.from(state, 'base64url').toString('utf8')).returnTo : APP_URL;
  res.redirect(returnTo || APP_URL);
});

app.post('/api/me/profile', requireAuth, async (req, res) => {
  const { displayName, pronouns, bio } = req.body || {};
  req.user.profile = { displayName, pronouns, bio };
  if (displayName) req.user.name = displayName;
  await req.user.save();
  res.json({ profile: req.user.profile });
});

app.get('/api/me/profile', requireAuth, async (req, res) => {
  res.json({
    profile: req.user.profile || {
      displayName: req.user.name || '',
      pronouns: '',
      bio: '',
    },
  });
});

app.get('/api/me/orders', requireAuth, async (req, res) => {
  const items = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
  res.json({ items });
});

app.get('/api/me/favorites', requireAuth, async (req, res) => {
  const items = req.user.favorites || [];
  res.json({ items });
});

app.post('/api/me/favorites', requireAuth, async (req, res) => {
  const favorite = req.body || {};
  req.user.favorites = [favorite, ...(req.user.favorites || [])].slice(0, 24);
  await req.user.save();
  res.json({ items: req.user.favorites });
});

app.post('/api/orders', requireAuth, async (req, res) => {
  const { name, contact, story, title, price, referenceImages } = req.body || {};
  const count = await Order.countDocuments();
  const storyNumber = String(count + 1).padStart(3, '0');
  const order = await Order.create({
    storyNumber,
    userId: req.user._id,
    email: req.user.email,
    name: name || req.user.name,
    contact,
    story,
    referenceImages: Array.isArray(referenceImages) ? referenceImages.slice(0, 5) : [],
    title: title || `Story #${storyNumber}`,
    description: story,
    price: price || 0,
    expectedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  await sendOrderStatusEmail(order, 'June has received your story');
  res.status(201).json({ order });
});

app.get('/api/admin/content', requireAdmin, async (_req, res) => {
  const docs = await Content.find().lean();
  const content = Object.fromEntries(docs.map((doc) => [doc.key, doc.data]));
  res.json(content);
});

app.put('/api/admin/content/:key', requireAdmin, async (req, res) => {
  const { key } = req.params;
  const data = req.body || {};
  const doc = await Content.findOneAndUpdate({ key }, { key, data }, { upsert: true, new: true });
  res.json({ key: doc.key, data: doc.data });
});

app.put('/api/admin/security', requireAdmin, async (req, res) => {
  const approvedAdminEmails = (req.body?.approvedAdminEmails || []).map((email) => String(email).toLowerCase());
  await Content.findOneAndUpdate(
    { key: 'security' },
    { key: 'security', data: { approvedAdminEmails } },
    { upsert: true, new: true },
  );

  await User.updateMany(
    { email: { $in: approvedAdminEmails } },
    { $set: { role: 'admin' } },
  );

  res.json({ approvedAdminEmails });
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  const items = await Order.find().sort({ createdAt: -1 }).lean();
  res.json({ items });
});

app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const { status, paymentStatus, note, shippingUpdate } = req.body || {};
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (status) {
    order.status = status;
    order.timeline = order.timeline.map((step) => ({
      ...step,
      active: step.label === status,
    }));
    if (!order.shippingUpdates) order.shippingUpdates = [];
    if (shippingUpdate) {
      order.shippingUpdates.push({ status, note: shippingUpdate, at: new Date() });
    }
    await sendOrderStatusEmail(order, status);
  }
  if (paymentStatus) order.paymentStatus = paymentStatus;
  if (note) order.note = note;
  await order.save();
  res.json({ order });
});

app.post('/api/uploads/cloudinary-signature', requireAuth, async (req, res) => {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.status(501).json({ error: 'Cloudinary is not configured.' });
  }
  const folder = req.body?.folder || 'artorabyjune';
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, timestamp };
  const signature = cloudinary.utils.api_sign_request(params, CLOUDINARY_API_SECRET);
  res.json({ timestamp, signature, folder, apiKey: CLOUDINARY_API_KEY, cloudName: CLOUDINARY_CLOUD_NAME });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'artora-by-june' });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'artorabyjune.html'));
});

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'artorabyjune.html'));
});

async function main() {
  await mongoose.connect(MONGODB_URI);
  await seedDefaults();

  app.listen(PORT, () => {
    console.log(`Artora by June running on ${APP_URL || `http://localhost:${PORT}`}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
