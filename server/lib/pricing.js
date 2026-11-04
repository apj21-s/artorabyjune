const { Product, Coupon } = require('../models');
const { getContent } = require('./content');

class PricingError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

async function findCoupon(code, type) {
  if (!code) return null;
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() });
  if (!coupon || !coupon.active) throw new PricingError('That coupon code isn’t valid.');
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new PricingError('That coupon has expired.');
  if (coupon.usageLimit && coupon.uses >= coupon.usageLimit) throw new PricingError('That coupon has been fully used.');
  if (coupon.appliesTo !== 'all' && coupon.appliesTo !== type) {
    throw new PricingError(coupon.appliesTo === 'shop' ? 'That coupon works on ready-made totes only.' : 'That coupon works on commissions only.');
  }
  return coupon;
}

function couponDiscount(coupon, subtotal) {
  if (!coupon) return 0;
  if (subtotal < (coupon.minOrder || 0)) {
    throw new PricingError(`That coupon needs an order of at least ₹${coupon.minOrder}.`);
  }
  const raw = coupon.kind === 'percent' ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
  return Math.min(subtotal, Math.max(0, raw));
}

async function findGiftCard(code) {
  const { GiftCard } = require('../models');
  const card = await GiftCard.findOne({ code: String(code).trim().toUpperCase() });
  if (!card || !card.active) throw new PricingError('That gift card code isn’t valid.');
  if (card.expiresAt && card.expiresAt < new Date()) throw new PricingError('That gift card has expired.');
  if (card.balance <= 0) throw new PricingError('That gift card has been fully used.');
  return card;
}

// Bundles: each product can name one partner; when both are in the bag, the discount applies per pair (once per pair).
function bundleSavings(lines, byId) {
  let saving = 0;
  const seen = new Set();
  for (const line of lines) {
    const product = byId.get(String(line.productId));
    if (!product?.bundleWith || !product.bundleDiscount) continue;
    const partner = lines.find((l) => String(l.productId) === String(product.bundleWith));
    if (!partner) continue;
    const key = [String(line.productId), String(partner.productId)].sort().join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    saving += Math.min(line.qty, partner.qty) * product.bundleDiscount;
  }
  return saving;
}

// Prices a shop cart from the database. Client prices are never trusted.
async function priceCart({ items = [], couponCode = '', giftWrap = false, giftCode = '' }) {
  if (!Array.isArray(items) || !items.length) throw new PricingError('Your cart is empty.');
  const site = await getContent('site');
  const ids = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids }, status: 'live' });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const problems = [];
  for (const item of items) {
    const product = byId.get(String(item.productId));
    const qty = Math.max(1, Math.min(10, Math.floor(Number(item.qty) || 1)));
    if (!product) {
      problems.push({ productId: item.productId, message: 'This item is no longer available.' });
      continue;
    }
    if (product.stock < qty) {
      problems.push({
        productId: item.productId,
        message: product.stock > 0 ? `Only ${product.stock} left of “${product.title}”.` : `“${product.title}” just sold out.`,
      });
      continue;
    }
    lines.push({
      productId: product._id,
      title: product.title,
      slug: product.slug,
      image: product.images[0] || '',
      price: product.price,
      qty,
      kind: product.kind || 'tote',
    });
  }

  const physical = lines.filter((l) => l.kind !== 'giftcard');
  const hasGiftCards = physical.length !== lines.length;
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const physicalSubtotal = physical.reduce((sum, l) => sum + l.price * l.qty, 0);
  const bundleDiscount = Math.min(physicalSubtotal, bundleSavings(physical, byId));
  // Coupons apply to totes only, never to gift cards.
  const coupon = couponCode ? await findCoupon(couponCode, 'shop') : null;
  const discount = physical.length ? couponDiscount(coupon, physicalSubtotal - bundleDiscount) : 0;
  const afterDiscount = physicalSubtotal - bundleDiscount - discount;
  const freeAbove = Number(site.freeShippingAbove) || 0;
  const shippingFee = !physical.length || (freeAbove && afterDiscount >= freeAbove) ? 0 : Number(site.shippingFlat) || 0;
  const giftWrapFee = giftWrap && physical.length ? Number(site.giftWrapFee) || 0 : 0;
  let total = subtotal - bundleDiscount - discount + shippingFee + giftWrapFee;

  let giftCardCode = '';
  let giftCardAmount = 0;
  let giftCardBalance = 0;
  if (giftCode) {
    if (hasGiftCards) throw new PricingError('Gift cards can’t be bought with a gift card.');
    const card = await findGiftCard(giftCode);
    giftCardCode = card.code;
    giftCardAmount = Math.min(card.balance, total);
    giftCardBalance = card.balance - giftCardAmount;
    total -= giftCardAmount;
  }

  return {
    lines,
    problems,
    subtotal,
    bundleDiscount,
    discount,
    couponCode: coupon?.code || '',
    shippingFee,
    giftWrapFee,
    giftCardCode,
    giftCardAmount,
    giftCardBalance,
    total,
    needsShipping: physical.length > 0,
    hasGiftCards,
    freeShippingAbove: freeAbove,
    toFreeShipping: freeAbove && physical.length ? Math.max(0, freeAbove - afterDiscount) : 0,
  };
}

// Commission totals once June has quoted. Deposit is a share of the total, rounded up.
async function priceCommission({ quote, couponCode = '', giftWrap = false }) {
  const site = await getContent('site');
  const subtotal = Math.max(0, Math.round(Number(quote) || 0));
  const coupon = couponCode ? await findCoupon(couponCode, 'commission') : null;
  const discount = couponDiscount(coupon, subtotal);
  const giftWrapFee = giftWrap ? Number(site.giftWrapFee) || 0 : 0;
  const total = subtotal - discount + giftWrapFee;
  const percent = Math.min(100, Math.max(0, Number(site.depositPercent) || 50));
  const depositAmount = Math.ceil((total * percent) / 100);
  return { subtotal, discount, couponCode: coupon?.code || '', giftWrapFee, shippingFee: 0, total, depositAmount, depositPercent: percent };
}

module.exports = { priceCart, priceCommission, findCoupon, findGiftCard, couponDiscount, PricingError };
