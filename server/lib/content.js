const { Content } = require('../models');

// Everything the owner can edit from Admin → Content. Seeded with the original site copy.
const DEFAULTS = {
  site: {
    announcement: 'Free shipping on ready-made totes above ₹999 · Commissions open',
    heroEyebrow: 'Every tote carries a story',
    heroTitle: 'Some moments deserve more than a photograph.',
    heroSubtitle: 'Choose a memory, and June turns it into a one-of-one canvas story. Hand-painted, quietly premium, and made to feel like a keepsake before it ever feels like a product.',
    heroNote: 'Scroll gently. The story unfolds below.',
    marquee: ['Painted to order', '100% hand-painted', 'Shipped pan-India', 'Sealed for daily use', 'One of one, always'],
    trustLine: 'Painted by hand in India · Ships pan-India · Sketch before paint',
    meetJuneTitle: 'Hi, I’m June.',
    meetJuneBody: 'I paint every tote myself, in a small studio full of drying racks and half-finished skies. You send the memory; I send back a sketch, then paint it slowly until it feels like yours.',
    instagram: 'artorabyjune',
    whatsapp: '',
    supportEmail: 'hello@artorabyjune.com',
    replyTime: 'June usually replies within a day.',
    upiId: '',
    upiName: 'Artora by June',
    depositPercent: 50,
    shippingFlat: 79,
    freeShippingAbove: 999,
    giftWrapFee: 49,
    cartReminders: true,
    dispatchDays: '2–3',
    deliveryDays: '3–7',
  },
  tiers: [
    {
      key: 'mini',
      title: 'Mini',
      price: 99,
      tag: 'Mini',
      turnaround: '3 to 5 days',
      days: 5,
      features: ['Small canvas pouch or mini tote', 'Single motif, up to 2 colours', '3 to 5 day turnaround'],
      featured: false,
    },
    {
      key: 'classic',
      title: 'Classic tote',
      price: 249,
      tag: 'Classic tote — most loved',
      turnaround: '5 to 7 days',
      days: 7,
      features: ['Full-size canvas tote', 'Full-colour custom artwork', 'Sketch preview included', '5 to 7 day turnaround'],
      featured: true,
    },
    {
      key: 'big',
      title: 'Big canvas',
      price: 449,
      tag: 'Big canvas',
      turnaround: '7 to 10 days',
      days: 10,
      features: ['Oversized tote', 'Full-colour custom artwork', 'Multi-figure or detailed scenes', '7 to 10 day turnaround'],
      featured: false,
    },
  ],
  faqs: [
    { group: 'Commissions', question: 'How does a custom commission work?', answer: 'Write June a note about your memory and add reference photos. June replies with a quote and a quick sketch. Once you approve and pay the deposit, she starts painting.' },
    { group: 'Commissions', question: 'How long does a story take?', answer: 'Most custom stories take between 5 and 10 days depending on the tier and detail, plus delivery time.' },
    { group: 'Commissions', question: 'Can I ask for changes to the sketch?', answer: 'Yes. You can request changes from your order page before approving. Small tweaks are always free.' },
    { group: 'Payments', question: 'How do payments work?', answer: 'Ready-made totes are paid in full at checkout. For commissions you pay a deposit after approving the sketch, and the balance before your tote ships. UPI, cards and netbanking are accepted.' },
    { group: 'Payments', question: 'Is the deposit refundable?', answer: 'The deposit covers materials and June’s time, so it is non-refundable once painting has begun. If you cancel before painting starts, it is refunded in full.' },
    { group: 'Shipping', question: 'Where do you ship?', answer: 'Everywhere in India. Orders are packed with care and shipped with tracking.' },
    { group: 'Shipping', question: 'Can I send it as a gift?', answer: 'Yes. Tick “This is a gift”, add a handwritten-style note, and we’ll leave the price off the parcel. Gift wrap is available too.' },
    { group: 'Care', question: 'Is the paint washable?', answer: 'Each tote is heat-sealed for daily use. Hand-wash gently in cold water, inside out, and dry in shade. Don’t scrub the painted area.' },
    { group: 'Orders', question: 'Can I save a memory before ordering?', answer: 'Yes. Create an account and save memories to your studio. You can turn any of them into a commission later.' },
  ],
  gifting: [
    { key: 'birthday', title: 'Birthdays', blurb: 'Their favourite thing, painted into something they carry every day.', colour: 'ochre' },
    { key: 'couples', title: 'Couples & anniversaries', blurb: 'Two people, one sunset, your own words underneath.', colour: 'cherry' },
    { key: 'pets', title: 'Pet parents', blurb: 'The one who’s never leaving your side anyway.', colour: 'sage' },
    { key: 'farewell', title: 'Farewells & new cities', blurb: 'The city you’re leaving, or the one they’re chasing.', colour: 'blue' },
    { key: 'festive', title: 'Festive & thank-yous', blurb: 'Small, thoughtful, one of one — for the people who show up.', colour: 'cherry' },
  ],
  about: {
    title: 'A small studio, one canvas at a time.',
    intro: 'Artora by June began with a single tote painted for a friend’s birthday. Today every piece is still painted by hand, by June, from a note someone wrote about a memory worth keeping.',
    paragraphs: [
      'No prints, no transfers, no shortcuts. Each tote is sketched in pencil, mixed by hand to the exact tone of your story, painted in layers, then heat-sealed so it can survive everyday life.',
      'Because every piece is made by hand, no two are identical. Small variations in brushwork are the point — they are proof that someone made this for you.',
    ],
    promises: [
      { title: 'Hand-painted, always', body: 'Every stroke is June’s. Nothing is printed.' },
      { title: 'Sketch before paint', body: 'You see and approve the composition before a brush touches canvas.' },
      { title: 'Sealed for daily use', body: 'Heat-set fabric paint, made to be carried, not framed.' },
      { title: 'Packed with care', body: 'Wrapped, tracked, and shipped pan-India.' },
    ],
  },
  portfolio: [
    { slug: 'movie-night', title: 'Movie night moments', category: 'Movie night moments', memory: 'A still from the film you quote too much.', art: 'movie', featured: true },
    { slug: 'couple-portraits', title: 'Couple portraits', category: 'Couple portraits', memory: 'Two people, one sunset, your own words underneath.', art: 'couple' },
    { slug: 'pet-portraits', title: 'Pet portraits', category: 'Pet portraits', memory: 'The one who’s never leaving your side anyway.', art: 'pet' },
    { slug: 'nature-critters', title: 'Nature & critters', category: 'Nature & critters', memory: 'Turtles, sunflowers, whatever’s calming you lately.', art: 'nature', wide: true },
    { slug: 'fandom-art', title: 'Fandom art', category: 'Fandom art', memory: 'Your favourite universe, painted your way.', art: 'fandom' },
    { slug: 'words-quotes', title: 'Words & quotes', category: 'Words & quotes', memory: 'A line that means something, lettered by hand.', art: 'words' },
    { slug: 'skylines-places', title: 'Skylines & places', category: 'Skylines & places', memory: 'The city you left, or the one you’re chasing.', art: 'skyline' },
    { slug: 'just-for-you', title: 'Something just for you', category: 'Something just for you', memory: 'No brief too weird — that’s kind of the point.', art: 'custom' },
  ],
  launch: {
    pricingReviewed: false,
    legalReviewed: false,
    reviewsReal: false,
  },
  security: {
    approvedAdminEmails: [],
  },
};

const EDITABLE_KEYS = ['site', 'tiers', 'faqs', 'gifting', 'about', 'portfolio', 'launch'];

const cache = new Map();
const CACHE_MS = 15_000;

async function getContent(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const doc = await Content.findOne({ key }).lean();
  const fallback = DEFAULTS[key];
  let value;
  if (Array.isArray(fallback)) value = Array.isArray(doc?.data) ? doc.data : fallback;
  else value = { ...(fallback || {}), ...((doc && doc.data) || {}) };
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function setContent(key, data) {
  await Content.findOneAndUpdate({ key }, { key, data }, { upsert: true, new: true });
  cache.delete(key);
  return getContent(key);
}

function clearContentCache() {
  cache.clear();
}

async function seedContent() {
  // One round trip for all sections; only fills in ones that don't exist yet.
  await Content.bulkWrite(Object.entries(DEFAULTS).map(([key, data]) => ({
    updateOne: { filter: { key }, update: { $setOnInsert: { key, data } }, upsert: true },
  })), { ordered: false });
}

module.exports = { DEFAULTS, EDITABLE_KEYS, getContent, setContent, seedContent, clearContentCache };
