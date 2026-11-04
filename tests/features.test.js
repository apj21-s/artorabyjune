const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, signedIn, request, address } = require('./helpers');
const { Product, Order, GiftCard, CartDraft } = require('../server/models');

let app;
let admin;
const product = (slug) => Product.findOne({ slug });
const checkout = (body) => request(app).post('/api/checkout').send({ name: 'Mira', email: 'mira@example.com', phone: '9876543210', address, ...body });
const markPaid = async (number) => {
  const o = await Order.findOne({ number });
  await admin.post(`/api/admin/orders/${o._id}/payments`).send({ kind: 'full', amount: o.total });
  return Order.findOne({ number });
};

before(async () => {
  app = await start();
  admin = await signedIn(app, { email: 'june@example.com', name: 'June' });
});
after(stop);

describe('search', () => {
  test('finds totes by title, tag or summary', async () => {
    const res = await request(app).get('/api/products').query({ q: 'sun' });
    const slugs = res.body.items.map((p) => p.slug);
    assert.ok(slugs.includes('sunday-sun'));
    assert.ok((await request(app).get('/api/products').query({ q: 'pets' })).body.items.some((p) => p.slug === 'pawprint-picnic'));
  });
  test('special characters are treated as text, not patterns', async () => {
    const res = await request(app).get('/api/products').query({ q: '.*(' });
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 0);
  });
  test('stories are searchable too', async () => {
    const res = await request(app).get('/api/portfolio').query({ q: 'pet' });
    assert.ok(res.body.items.length >= 1);
  });
});

describe('saved totes', () => {
  test('signed-in customers can save and read back their list', async () => {
    const agent = await signedIn(app, { email: 'saver@example.com' });
    const [a, b] = [await product('sunday-sun'), await product('movie-night')];
    const put = await agent.put('/api/me/saved').send({ ids: [String(a._id), String(b._id), String(a._id)] });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.ids, [String(a._id), String(b._id)], 'duplicates removed');
    const got = await agent.get('/api/me/saved');
    assert.equal(got.body.items.length, 2);
    assert.equal((await agent.put('/api/me/saved').send({ ids: ['nope'] })).status, 400);
    assert.equal((await request(app).get('/api/me/saved')).status, 401);
  });
});

describe('bundles', () => {
  test('the pair discount applies only when both are in the bag', async () => {
    const [turtle, pouch] = [await product('turtle-garden'), await product('sunflower-pouch')];
    const one = await request(app).post('/api/cart/quote').send({ items: [{ productId: String(turtle._id), qty: 1 }] });
    assert.equal(one.body.bundleDiscount, 0);
    const both = await request(app).post('/api/cart/quote').send({ items: [{ productId: String(turtle._id), qty: 1 }, { productId: String(pouch._id), qty: 2 }] });
    assert.equal(both.body.bundleDiscount, 100, 'one pair → ₹100 once');
    assert.equal(both.body.total, turtle.price + pouch.price * 2 - 100 + both.body.shippingFee);
  });
});

describe('gift cards', () => {
  let code;

  test('buying one needs no address, and a code is issued once paid', async () => {
    const card = await product('gift-card-1000');
    const res = await request(app).post('/api/checkout').send({
      items: [{ productId: String(card._id), qty: 1 }], name: 'Mira', email: 'mira@example.com', phone: '9876543210',
      giftCard: { recipientEmail: 'friend@example.com', recipientName: 'Kiran', message: 'Happy birthday!' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = await Order.findOne({ number: res.body.number });
    assert.equal(order.shippingFee, 0);
    assert.equal(order.total, 1000);
    await markPaid(res.body.number);
    const issued = await GiftCard.findOne({ orderNumber: res.body.number });
    assert.ok(issued, 'card created on payment');
    assert.equal(issued.balance, 1000);
    assert.equal(issued.recipientEmail, 'friend@example.com');
    assert.match(issued.code, /^ART-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    code = issued.code;
    await markPaid(res.body.number);
    assert.equal(await GiftCard.countDocuments({ orderNumber: res.body.number }), 1, 'never issued twice');
  });

  test('coupons do not apply to gift cards, and gift cards cannot buy gift cards', async () => {
    const card = await product('gift-card-500');
    const q = await request(app).post('/api/cart/quote').send({ items: [{ productId: String(card._id), qty: 1 }], couponCode: 'BEGIN10' });
    assert.equal(q.body.discount, 0);
    const bad = await request(app).post('/api/cart/quote').send({ items: [{ productId: String(card._id), qty: 1 }], giftCode: code });
    assert.equal(bad.status, 400);
  });

  test('partial redemption leaves the rest on the card', async () => {
    const city = await product('city-of-lights'); // ₹1,199, free shipping
    const res = await checkout({ items: [{ productId: String(city._id), qty: 1 }], giftCode: code.toLowerCase() });
    assert.equal(res.status, 201);
    const order = await Order.findOne({ number: res.body.number });
    assert.equal(order.giftCardAmount, 1000);
    assert.equal(order.total, 199);
    await markPaid(res.body.number);
    assert.equal((await GiftCard.findOne({ code })).balance, 0);
  });

  test('a fully covered order confirms straight away', async () => {
    const credit = await admin.post('/api/admin/giftcards').send({ initialAmount: 2000, note: 'refund' });
    assert.equal(credit.status, 201);
    const sun = await product('sunday-sun');
    const res = await checkout({ items: [{ productId: String(sun._id), qty: 1 }], giftCode: credit.body.item.code });
    assert.equal(res.body.payment.provider, 'none');
    const order = await Order.findOne({ number: res.body.number });
    assert.equal(order.paymentStatus, 'paid');
    assert.equal(order.status, 'confirmed');
    assert.equal((await GiftCard.findById(credit.body.item._id)).balance, 2000 - order.giftCardAmount);
  });

  test('expired and empty cards are refused', async () => {
    const old = await GiftCard.create({ code: 'ART-OLD1-OLD1', initialAmount: 500, balance: 500, expiresAt: new Date(Date.now() - 1000) });
    const sun = await product('sunday-sun');
    assert.equal((await request(app).post('/api/cart/quote').send({ items: [{ productId: String(sun._id), qty: 1 }], giftCode: old.code })).status, 400);
    assert.equal((await request(app).post('/api/cart/quote').send({ items: [{ productId: String(sun._id), qty: 1 }], giftCode: code })).status, 400);
  });
});

describe('abandoned-cart reminder', () => {
  const { runCartReminders, WAIT_MS } = require('../server/services/reminders');
  const later = () => new Date(Date.now() + WAIT_MS + 60_000);

  test('one reminder, never twice, and none after an order', async () => {
    const movie = await product('movie-night');
    const items = [{ productId: String(movie._id), qty: 1 }];
    assert.equal((await request(app).post('/api/cart/draft').send({ email: 'leaver@example.com', items })).status, 201);
    assert.equal((await request(app).post('/api/cart/draft').send({ email: 'buyer@example.com', items })).status, 201);
    await request(app).post('/api/checkout').send({ items, name: 'B', email: 'buyer@example.com', phone: '9876543210', address });

    assert.equal(await runCartReminders({ now: new Date(), force: true }), 0, 'too soon');
    assert.equal(await runCartReminders({ now: later(), force: true }), 1);
    assert.equal(await runCartReminders({ now: later(), force: true }), 0, 'only once');
    assert.ok((await CartDraft.findOne({ email: 'buyer@example.com' })).orderPlacedAt);
  });

  test('unsubscribe stops reminders for that email, and the restore link returns the bag', async () => {
    const sun = await product('sunday-sun');
    await request(app).post('/api/cart/draft').send({ email: 'quiet@example.com', items: [{ productId: String(sun._id), qty: 2 }] });
    const draft = await CartDraft.findOne({ email: 'quiet@example.com' });
    const restore = await request(app).get(`/api/cart/draft/${draft.token}`);
    assert.equal(restore.body.items[0].qty, 2);
    assert.equal(restore.body.items[0].product.slug, 'sunday-sun');
    assert.equal((await request(app).get(`/api/cart/unsubscribe/${draft.token}`)).status, 200);
    assert.equal(await runCartReminders({ now: later(), force: true }), 0);
  });
});
