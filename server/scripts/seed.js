// Fills an empty database with sample products, reviews and coupons so the site looks alive.
// Safe to re-run: it only adds things that don't exist yet. Use --reset to replace sample data.
const mongoose = require('mongoose');
const config = require('../config');
const { Product, Review, Coupon } = require('../models');
const { seedContent } = require('../lib/content');

const P = (slug) => [`/assets/totes/${slug}.svg`, `/assets/totes/${slug}-back.svg`];

const PRODUCTS = [
  { title: 'Sunday Sun', slug: 'sunday-sun', price: 899, stock: 3, featured: true, badge: 'Bestseller', tags: ['nature', 'birthday', 'festive'], colour: 'Blue', summary: 'A lazy sun over blue hills, with a dotted line of cherry thread.', description: 'The tote that started the studio. Painted from the view outside June’s window on a slow Sunday — ochre sun, two small birds and hills that never quite sit still.' },
  { title: 'Movie Night', slug: 'movie-night', price: 1099, stock: 2, featured: true, badge: 'New', tags: ['couples', 'birthday'], colour: 'Blue', summary: 'Two heads in the front row, a crescent moon, and the film you quote too much.', description: 'For the people you watch everything with. A tiny outdoor screen under a night sky, painted in layered blues.' },
  { title: 'Pawprint Picnic', slug: 'pawprint-picnic', price: 949, stock: 1, featured: true, tags: ['pets', 'birthday'], colour: 'Ochre', summary: 'A very good dog in a cherry bandana, waiting for snacks.', description: 'Every pet parent knows this face. Want it to be your dog? Commission a pet portrait and June will paint yours.' },
  { title: 'Turtle Garden', slug: 'turtle-garden', price: 899, stock: 4, featured: true, badge: 'Limited', tags: ['nature', 'farewell'], colour: 'Sage', summary: 'A sunflower, a small turtle, and nowhere in particular to be.', description: 'Painted for anyone who needs reminding to slow down. Sage greens and warm sunflower yellow.' },
  { title: 'City of Lights', slug: 'city-of-lights', price: 1199, stock: 2, tags: ['farewell', 'festive'], colour: 'Blue', summary: 'A skyline at dusk, every window lit by hand.', description: 'For the city you left, or the one you’re chasing. Each tiny window is painted one at a time.' },
  { title: 'Softly, Softly', slug: 'softly-softly', price: 799, stock: 0, tags: ['festive', 'birthday'], colour: 'Ochre', summary: 'Two words, lettered by hand. A small reminder to go easy.', description: 'Hand-lettered in ink and cherry on a peach wash. Sold out — leave your email and June will tell you when the next batch dries.' },
  { title: 'Heart on a Sleeve', slug: 'heart-on-a-sleeve', price: 999, stock: 2, badge: 'One of one', tags: ['couples'], colour: 'Cherry', summary: 'Two silhouettes, one sunset, and a heart that couldn’t stay quiet.', description: 'A couple tote painted in cherry reds and evening ochre. Lovely as an anniversary gift.' },
  { title: 'Starlit Fandom', slug: 'starlit-fandom', price: 1049, stock: 1, tags: ['birthday'], colour: 'Black', summary: 'A little card of magic floating in a field of stars.', description: 'Painted on dark canvas for the dreamers and the fandom kids. Want your favourite universe? Commission it.' },
  { title: 'Gift card · ₹500', slug: 'gift-card-500', price: 500, stock: 9999, kind: 'giftcard', tags: ['gift card', 'birthday', 'festive'], colour: '', summary: 'Let them choose their own story. Emailed with your note, valid for a year.', description: 'A digital Artora gift card, emailed instantly once paid. Works on ready-made totes and on commissions.', images: ['/assets/illustrations/gift-card-500.svg'] },
  { title: 'Gift card · ₹1,000', slug: 'gift-card-1000', price: 1000, stock: 9999, kind: 'giftcard', tags: ['gift card', 'birthday', 'couples', 'festive'], colour: '', summary: 'Enough for a full commission deposit, or a tote and a pouch.', description: 'A digital Artora gift card, emailed instantly once paid. Works on ready-made totes and on commissions.', images: ['/assets/illustrations/gift-card-1000.svg'] },
  { title: 'Sunflower Pouch', slug: 'sunflower-pouch', price: 449, stock: 5, tags: ['festive', 'nature'], colour: 'Sage', summary: 'A zip pouch with a tiny painted garden. For pens, keys and small joys.', description: 'The mini version of Turtle Garden. Small enough to gift in a bundle.', details: { size: 'Approx. 22 × 16 cm, zip top' } },
];

const DEFAULT_DETAILS = {
  size: 'Approx. 38 × 42 cm, 10 cm gusset, 60 cm handles',
  material: 'Heavy 12 oz natural cotton canvas, heat-set fabric paint',
  care: 'Hand-wash cold, inside out. Don’t scrub the painted area. Dry in shade. Iron on the reverse.',
};

const REVIEWS = [
  { name: 'Ananya', city: 'Hyderabad', rating: 5, text: 'Sent one blurry photo and got back something better than I imagined. Wearing it everywhere.', approved: true, featured: true },
  { name: 'Rehan', city: 'Bangalore', rating: 5, text: 'The sketch preview made it feel like commissioning real art, not just ordering a bag.', approved: true },
  { name: 'Srijita', city: 'Kolkata', rating: 5, text: 'Gifted it to my best friend and he cried a little. 10/10 birthday move.', approved: true },
];

const COUPONS = [
  { code: 'BEGIN10', kind: 'percent', value: 10, appliesTo: 'all', active: true, note: 'First order welcome' },
  { code: 'STORY50', kind: 'flat', value: 50, appliesTo: 'all', minOrder: 499, active: false, note: 'Sample flat coupon' },
];

async function seed({ reset = false } = {}) {
  await seedContent();
  if (reset) {
    await Product.deleteMany({ slug: { $in: PRODUCTS.map((p) => p.slug) } });
    await Review.deleteMany({ orderNumber: { $exists: false } });
  }
  let added = 0;
  for (const [i, p] of PRODUCTS.entries()) {
    const res = await Product.updateOne(
      { slug: p.slug },
      { $setOnInsert: { ...p, images: p.images || P(p.slug), details: p.kind === 'giftcard' ? { size: 'Digital · emailed instantly', material: 'Valid for 12 months', care: 'Use the code at checkout' } : { ...DEFAULT_DETAILS, ...(p.details || {}) }, status: 'live', sortOrder: i } },
      { upsert: true },
    );
    added += res.upsertedCount;
  }
  // Sample bundle: Turtle Garden + Sunflower Pouch, ₹100 off together.
  const [turtle, pouch] = await Promise.all([Product.findOne({ slug: 'turtle-garden' }), Product.findOne({ slug: 'sunflower-pouch' })]);
  if (turtle && pouch && !turtle.bundleWith) await Product.updateOne({ _id: turtle._id }, { $set: { bundleWith: pouch._id, bundleDiscount: 100 } });
  if (!(await Review.estimatedDocumentCount())) await Review.insertMany(REVIEWS);
  for (const c of COUPONS) await Coupon.updateOne({ code: c.code }, { $setOnInsert: c }, { upsert: true });
  return { productsAdded: added };
}

module.exports = { seed, PRODUCTS };

if (require.main === module) {
  (async () => {
    await mongoose.connect(config.mongoUri);
    const result = await seed({ reset: process.argv.includes('--reset') });
    console.log(`Seeded. ${result.productsAdded} sample products added. Sample reviews and coupons are in place.`);
    console.log('Replace the sample products and reviews from /admin before launch.');
    await mongoose.disconnect();
  })().catch((e) => { console.error(e); process.exit(1); });
}
