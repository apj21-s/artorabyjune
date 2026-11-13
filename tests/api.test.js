const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, signedIn, request, address } = require('./helpers');
const { Product, Order, Coupon } = require('../server/models');

let app;
let admin;
const product = (slug) => Product.findOne({ slug });

before(async () => {
  app = await start();
  admin = await signedIn(app, { email: 'june@example.com', name: 'June' });
});
after(stop);

describe('site and security', () => {
  test('pages render and private files are never served', async () => {
    for (const p of ['/', '/shop', '/shop/sunday-sun', '/commission', '/faq', '/track', '/robots.txt', '/sitemap.xml']) {
      const res = await request(app).get(p);
      assert.equal(res.status, 200, p);
    }
    for (const p of ['/server/index.js', '/.env', '/package.json', '/legacy-index.html', '/shop/not-a-real-tote']) {
      assert.equal((await request(app).get(p)).status, 404, p);
    }
  });

  test('security headers are set', async () => {
    const res = await request(app).get('/');
    assert.ok(res.headers['content-security-policy']);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('cross-site POSTs are blocked', async () => {
    const res = await request(app).post('/api/subscribe').set('Origin', 'https://evil.example').send({ email: 'a@b.co' });
    assert.equal(res.status, 403);
  });

  test('production refuses to boot with a weak secret', () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, ['-e', "process.env.NODE_ENV='production';process.env.JWT_SECRET='replace-me';process.env.APP_URL='http://x';delete process.env.MONGODB_URI;console.log(JSON.stringify(require('./server/config').validate()))"], { cwd: require('path').join(__dirname, '..'), env: { PATH: process.env.PATH } });
    const problems = JSON.parse(out);
    assert.equal(problems.length, 3);
  });
});

describe('accounts and admin access', () => {
  test('register, me, logout', async () => {
    const agent = await signedIn(app, { email: 'asha@example.com' });
    const me = await agent.get('/api/auth/me');
    assert.equal(me.body.user.email, 'asha@example.com');
    assert.equal(me.body.user.role, 'customer');
    await agent.post('/api/auth/logout');
    assert.equal((await agent.get('/api/auth/me')).body.user, null);
  });

  test('duplicate email and wrong password are rejected', async () => {
    assert.equal((await request(app).post('/api/auth/register').send({ name: 'X', email: 'asha@example.com', password: 'another-password' })).status, 409);
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'wrong-password' })).status, 401);
    assert.equal((await request(app).post('/api/auth/register').send({ name: 'X', email: 'short@example.com', password: 'short' })).status, 400);
  });

  test('admin API needs an admin', async () => {
    assert.equal((await request(app).get('/api/admin/stats')).status, 401);
    const customer = await signedIn(app, { email: 'nosy@example.com' });
    assert.equal((await customer.get('/api/admin/stats')).status, 403);
    assert.equal((await admin.get('/api/admin/stats')).status, 200);
  });

  test('admin can only edit whitelisted content', async () => {
    assert.equal((await admin.put('/api/admin/content/security').send({ approvedAdminEmails: ['me@evil.example'] })).status, 400);
  });
});

describe('shop checkout', () => {
  test('server prices the cart, ignores client prices, applies coupon and shipping', async () => {
    const sun = await product('sunday-sun');
    const res = await request(app).post('/api/cart/quote').send({ items: [{ productId: String(sun._id), qty: 1, price: 1 }], couponCode: 'BEGIN10' });
    assert.equal(res.status, 200);
    assert.equal(res.body.subtotal, sun.price);
    assert.equal(res.body.discount, Math.round(sun.price * 0.1));
    assert.equal(res.body.shippingFee, 79); // under the free-shipping line after discount
    assert.equal(res.body.total, sun.price - res.body.discount + 79);
  });

  test('invalid and inactive coupons are rejected', async () => {
    const sun = await product('sunday-sun');
    for (const code of ['NOPE', 'STORY50']) {
      const res = await request(app).post('/api/cart/quote').send({ items: [{ productId: String(sun._id), qty: 1 }], couponCode: code });
      assert.equal(res.status, 400, code);
    }
  });

  test('sold-out items cannot be checked out', async () => {
    const soft = await product('softly-softly');
    const res = await request(app).post('/api/checkout').send({ items: [{ productId: String(soft._id), qty: 1 }], name: 'A', email: 'a@example.com', phone: '9876543210', address });
    assert.equal(res.status, 409);
  });

  test('guest order → manual UPI → admin marks paid → stock drops → track', async () => {
    const city = await product('city-of-lights');
    const res = await request(app).post('/api/checkout').send({
      items: [{ productId: String(city._id), qty: 1 }], name: 'Asha', email: 'Guest@Example.com', phone: '9876543210', address, gift: { isGift: true, note: 'Happy birthday!', wrap: true },
    });
    assert.equal(res.status, 201);
    assert.match(res.body.number, /^AJ-\d{4}$/);
    assert.equal(res.body.payment.provider, 'upi');
    assert.equal(res.body.payment.kind, 'full');

    const order = await Order.findOne({ number: res.body.number });
    assert.equal(order.email, 'guest@example.com');
    assert.equal(order.giftWrapFee, 49);
    assert.equal(order.total, city.price + 49); // free shipping above ₹999
    assert.equal((await product('city-of-lights')).stock, city.stock, 'stock is held until payment');

    assert.equal((await admin.post(`/api/admin/orders/${order._id}/payments`).send({ kind: 'full', amount: order.total })).status, 200);
    const paid = await Order.findById(order._id);
    assert.equal(paid.paymentStatus, 'paid');
    assert.equal(paid.status, 'confirmed');
    assert.equal((await product('city-of-lights')).stock, city.stock - 1);

    const track = await request(app).get('/api/orders/track').query({ number: order.number, email: 'guest@example.com' });
    assert.equal(track.status, 200);
    assert.equal(track.body.order.status, 'confirmed');
    assert.equal(track.body.order.shippingAddress, undefined, 'tracking never leaks the address');
    assert.equal((await request(app).get('/api/orders/track').query({ number: order.number, email: 'other@example.com' })).status, 404);
  });

  test('order pages need the owner or the secret link', async () => {
    const order = await Order.findOne({ type: 'shop' });
    assert.equal((await request(app).get(`/api/orders/${order.number}`)).status, 404);
    assert.equal((await request(app).get(`/api/orders/${order.number}`).query({ t: 'wrong' })).status, 404);
    assert.equal((await request(app).get(`/api/orders/${order.number}`).query({ t: order.accessToken })).status, 200);
  });

  test('paying for an already-sold last item flags the order instead of going negative', async () => {
    const dog = await product('pawprint-picnic'); // stock 1
    const place = (who) => request(app).post('/api/checkout').send({ items: [{ productId: String(dog._id), qty: 1 }], name: who, email: `${who}@example.com`, phone: '9876543210', address });
    const [a, b] = [await place('first'), await place('second')];
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    for (const r of [a, b]) {
      const o = await Order.findOne({ number: r.body.number });
      await admin.post(`/api/admin/orders/${o._id}/payments`).send({ kind: 'full', amount: o.total });
    }
    assert.equal((await product('pawprint-picnic')).stock, 0);
    const second = await Order.findOne({ number: b.body.number });
    assert.match(second.internalNotes, /OVERSOLD/);
  });

  test('a coupon use is counted once the order is paid', async () => {
    const before = (await Coupon.findOne({ code: 'BEGIN10' })).uses;
    const turtle = await product('turtle-garden');
    const res = await request(app).post('/api/checkout').send({ items: [{ productId: String(turtle._id), qty: 1 }], couponCode: 'begin10', name: 'C', email: 'c@example.com', phone: '9876543210', address });
    const o = await Order.findOne({ number: res.body.number });
    assert.equal(o.couponCode, 'BEGIN10');
    await admin.post(`/api/admin/orders/${o._id}/payments`).send({ kind: 'full', amount: o.total });
    assert.equal((await Coupon.findOne({ code: 'BEGIN10' })).uses, before + 1);
  });
});

describe('commission journey', () => {
  let number;
  let token;
  let id;

  test('guest sends a commission', async () => {
    const res = await request(app).post('/api/commissions').send({
      tier: 'classic', story: 'Our dog Biscuit on the beach in Goa, ears flying.', name: 'Rehan', email: 'rehan@example.com', moods: ['Playful'],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ({ number, token } = res.body);
    id = String((await Order.findOne({ number }))._id);
  });

  test('a too-short story or unknown tier is rejected', async () => {
    assert.equal((await request(app).post('/api/commissions').send({ tier: 'classic', story: 'hi', name: 'R', email: 'r@example.com' })).status, 400);
    assert.equal((await request(app).post('/api/commissions').send({ tier: 'giant', story: 'A long enough story here.', name: 'R', email: 'r@example.com' })).status, 400);
  });

  test('cannot approve before June quotes', async () => {
    assert.equal((await request(app).post(`/api/orders/${number}/approve`).send({ t: token })).status, 409);
  });

  test('June quotes, customer asks for changes, June re-quotes', async () => {
    const q = await admin.post(`/api/admin/orders/${id}/quote`).send({ price: 1299, message: 'Sketch attached!' });
    assert.equal(q.status, 200);
    assert.equal(q.body.depositAmount, 650); // 50%, rounded up
    const ch = await request(app).post(`/api/orders/${number}/changes`).send({ t: token, message: 'Can Biscuit be a bit fluffier?' });
    assert.equal(ch.status, 200);
    assert.equal(ch.body.order.status, 'received');
    assert.equal((await admin.post(`/api/admin/orders/${id}/quote`).send({ price: 1299 })).status, 200);
  });

  test('approve → deposit paid → balance due → balance paid', async () => {
    const ap = await request(app).post(`/api/orders/${number}/approve`).send({ t: token });
    assert.equal(ap.status, 200);
    assert.equal(ap.body.payment.provider, 'upi');
    assert.equal(ap.body.payment.kind, 'deposit');
    assert.equal(ap.body.payment.amount, 650);

    await admin.post(`/api/admin/orders/${id}/payments`).send({ kind: 'deposit', amount: 650 });
    let view = (await request(app).get(`/api/orders/${number}`).query({ t: token })).body.order;
    assert.equal(view.paymentStatus, 'deposit_paid');
    assert.equal(view.status, 'confirmed');
    assert.equal(view.balanceDue, 649);
    assert.equal(view.canPayBalance, true);

    assert.equal((await admin.post(`/api/admin/orders/${id}/quote`).send({ price: 10 })).status, 409, 'quote is locked after deposit');

    const pay = await request(app).post(`/api/orders/${number}/pay`).send({ t: token });
    assert.equal(pay.body.payment.amount, 649);
    await admin.post(`/api/admin/orders/${id}/payments`).send({ kind: 'balance', amount: 649 });
    view = (await request(app).get(`/api/orders/${number}`).query({ t: token })).body.order;
    assert.equal(view.paymentStatus, 'paid');
    assert.equal(view.balanceDue, 0);
  });

  test('stages move forward and reviews open on delivery', async () => {
    assert.equal((await request(app).post(`/api/orders/${number}/review`).send({ t: token, rating: 5, text: 'Love it!' })).status, 409);
    assert.equal((await admin.patch(`/api/admin/orders/${id}`).send({ status: 'not-a-stage' })).status, 400);
    for (const status of ['shipped', 'delivered']) {
      assert.equal((await admin.patch(`/api/admin/orders/${id}`).send({ status, tracking: { courier: 'Delhivery', number: 'DL123' } })).status, 200, status);
    }
    assert.equal((await request(app).post(`/api/orders/${number}/review`).send({ t: token, rating: 5, text: 'Biscuit approves.' })).status, 201);
    assert.equal((await request(app).post(`/api/orders/${number}/review`).send({ t: token, rating: 5, text: 'Again!' })).status, 409);
    const reviews = (await request(app).get('/api/reviews')).body;
    assert.ok(!JSON.stringify(reviews).includes('Biscuit approves'), 'new reviews wait for approval');
  });

  test('a guest order shows up only once the customer confirms the email', async () => {
    const agent = await signedIn(app, { email: 'rehan@example.com', name: 'Rehan' });
    const before = await agent.get('/api/me/orders');
    assert.ok(!JSON.stringify(before.body).includes(number), 'an unconfirmed account must not see orders placed with that email');
    const { User } = require('../server/models');
    await User.updateOne({ email: 'rehan@example.com' }, { $set: { emailVerified: true } });
    const after = await agent.get('/api/me/orders');
    assert.ok(JSON.stringify(after.body).includes(number));
  });

  test('opening the private order link while signed in adds the order to the account', async () => {
    const agent = await signedIn(app, { email: 'someone.else@example.com', name: 'Someone' });
    const placed = await request(app).post('/api/commissions').send({ tier: 'mini', story: 'A lighthouse for my dad, please.', name: 'Dad', email: 'dad.order@example.com' });
    await agent.get(`/api/orders/${placed.body.number}?t=${placed.body.token}`).expect(200);
    const mine = await agent.get('/api/me/orders');
    assert.ok(JSON.stringify(mine.body).includes(placed.body.number));
  });
});

describe('order numbers', () => {
  test('stay unique under concurrent orders', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => request(app).post('/api/commissions').send({
      tier: 'mini', story: 'A small sunflower for my mother.', name: `N${i}`, email: `n${i}@example.com`,
    })));
    const numbers = results.map((r) => r.body.number);
    assert.equal(new Set(numbers).size, 15);
  });
});
