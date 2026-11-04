// One gentle reminder for bags left at checkout. Runs inside the web process every 30 minutes;
// only active when order emails (Resend) are connected and the toggle in Admin → Site content is on.
const config = require('../config');
const { CartDraft, Product } = require('../models');
const { getContent } = require('../lib/content');
const mail = require('./email');

const WAIT_MS = 6 * 60 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function runCartReminders({ now = new Date(), force = false } = {}) {
  if (!force && !config.features.email) return 0;
  const site = await getContent('site');
  if (site.cartReminders === false) return 0;
  const drafts = await CartDraft.find({
    createdAt: { $lte: new Date(now - WAIT_MS), $gte: new Date(now - MAX_AGE_MS) },
    remindedAt: { $exists: false },
    orderPlacedAt: { $exists: false },
    unsubscribed: false,
  }).limit(50);
  let sent = 0;
  for (const draft of drafts) {
    // Never remind anyone who opted out, even from another draft.
    if (await CartDraft.exists({ email: draft.email, unsubscribed: true })) { draft.unsubscribed = true; await draft.save(); continue; }
    const products = await Product.find({ _id: { $in: draft.items.map((i) => i.productId) }, status: 'live', stock: { $gt: 0 } });
    draft.remindedAt = now;
    await draft.save();
    if (!products.length) continue;
    await mail.send({ to: draft.email, ...mail.templates.cartReminder(draft, products.map((p) => ({ title: p.title, price: p.price }))) });
    sent += 1;
  }
  return sent;
}

function startReminders() {
  if (config.isTest) return null;
  const timer = setInterval(() => runCartReminders().catch((e) => console.error('[reminders]', e.message)), 30 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { runCartReminders, startReminders, WAIT_MS };
