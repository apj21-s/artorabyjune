// Checkout email codes: a fake or mistyped address can't place an order.
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { start, stop, signedIn, request, address } = require('./helpers');
const { Product, Order, EmailCode, User } = require('../server/models');
const mail = require('../server/services/email');
const config = require('../server/config');

let app;
let outbox = [];
const capture = { async sendMail(msg) { outbox.push(msg); return { messageId: `<${outbox.length}@test>` }; } };
const codeFor = (to) => {
  const msg = [...outbox].reverse().find((m) => m.to === to);
  return msg && /(\d{6}) is your Artora by June code/.exec(msg.subject)?.[1];
};
const send = (email, agent = request(app)) => agent.post('/api/checkout/email-code').send({ email });
const verify = (email, code, agent = request(app)) => agent.post('/api/checkout/email-code/verify').send({ email, code });
const order = async (email, emailProof, agent = request(app)) => {
  const sun = await Product.findOne({ slug: 'sunday-sun' });
  return agent.post('/api/checkout').send({ items: [{ productId: String(sun._id), qty: 1 }], name: 'Kai', email, phone: '9876543210', address, emailProof });
};
// Lets the next send through the 30-second wait.
const age = (email) => EmailCode.updateMany({ email }, { $set: { sentAt: new Date(Date.now() - 31 * 1000) } });

before(async () => {
  app = await start();
  await Product.updateOne({ slug: 'sunday-sun' }, { $set: { stock: 50 } });
  mail._setTestTransport(capture);
});
after(async () => { mail._setTestTransport(null); await stop(); });
beforeEach(async () => { outbox = []; await EmailCode.deleteMany({}); });

describe('checkout email code', () => {
  test('send → verify → checkout; the code isn’t kept in the email log', async () => {
    assert.equal((await send('kai@example.com')).status, 200);
    const code = codeFor('kai@example.com');
    assert.match(code, /^\d{6}$/);
    const v = await verify('kai@example.com', code);
    assert.equal(v.status, 200);
    assert.ok(v.body.emailProof);
    const res = await order('kai@example.com', v.body.emailProof);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((await Order.findOne({ number: res.body.number })).emailVerified, true);
    const { EmailLog } = require('../server/models');
    const log = await EmailLog.findOne({ kind: 'checkout-code', to: 'kai@example.com' });
    assert.equal(log.html, undefined);
    assert.equal(log.text, undefined);
    assert.ok(!(await EmailCode.findOne({ email: 'kai@example.com' })).codeHash.includes(code));
  });

  test('checkout without a proof, or with someone else’s proof, is refused', async () => {
    const none = await order('nobody@example.com', '');
    assert.equal(none.status, 400);
    assert.equal(none.body.needsEmailCode, true);
    await send('real@example.com');
    const proof = (await verify('real@example.com', codeFor('real@example.com'))).body.emailProof;
    assert.equal((await order('other@example.com', proof)).status, 400);
    const session = jwt.sign({ sub: 'x', role: 'customer' }, config.jwtSecret, { expiresIn: '1h' });
    assert.equal((await order('real@example.com', session)).status, 400, 'a sign-in token is not an email proof');
    const expired = jwt.sign({ email: 'real@example.com', purpose: 'checkout-email' }, config.jwtSecret, { expiresIn: -10, audience: 'checkout-email' });
    assert.equal((await order('real@example.com', expired)).status, 400);
  });

  test('five wrong tries use the code up', async () => {
    await send('guess@example.com');
    const code = codeFor('guess@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) assert.equal((await verify('guess@example.com', wrong)).status, 400, `try ${i + 1}`);
    assert.equal((await verify('guess@example.com', code)).status, 429, 'even the right code is refused now');
  });

  test('guessing in parallel can’t get past five tries', async () => {
    await age('burst@example.com');
    await send('burst@example.com');
    const code = codeFor('burst@example.com');
    const guesses = Array.from({ length: 12 }, (_, i) => String((Number(code) + i + 1) % 1_000_000).padStart(6, '0'));
    const results = await Promise.all(guesses.map((g) => verify('burst@example.com', g)));
    assert.ok(results.every((r) => r.status !== 200));
    assert.ok((await EmailCode.findOne({ email: 'burst@example.com' })).attempts <= 5);
  });

  test('codes expire', async () => {
    await send('late@example.com');
    const code = codeFor('late@example.com');
    await EmailCode.updateMany({ email: 'late@example.com' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await verify('late@example.com', code)).status, 400);
  });

  test('a new code needs a 30-second wait; the old code stops working', async () => {
    assert.equal((await send('wait@example.com')).status, 200);
    const first = codeFor('wait@example.com');
    assert.equal((await send('wait@example.com')).status, 429);
    await age('wait@example.com');
    assert.equal((await send('wait@example.com')).status, 200);
    const second = codeFor('wait@example.com');
    if (first !== second) assert.equal((await verify('wait@example.com', first)).status, 400);
    assert.equal((await verify('wait@example.com', second)).status, 200);
  });

  test('at most five codes an hour per inbox, counting Gmail dot and +tag spellings as one', async () => {
    const spellings = ['sam.lee@gmail.com', 'samlee@gmail.com', 'sam.lee+shop@gmail.com', 'S.am.Lee@gmail.com', 'samlee+x@googlemail.com'];
    for (const e of spellings) {
      assert.equal((await send(e)).status, 200, e);
      await EmailCode.updateMany({}, { $set: { sentAt: new Date(Date.now() - 31 * 1000) } });
    }
    assert.equal((await send('s.a.m.l.e.e@gmail.com')).status, 429);
  });

  test('at most twenty codes an hour from one connection', async () => {
    await EmailCode.deleteMany({});
    await send('ip1@example.com');
    const { ipKey } = await EmailCode.findOne({ email: 'ip1@example.com' });
    const now = Date.now();
    await EmailCode.insertMany(Array.from({ length: 19 }, (_, i) => ({ email: `ipx${i}@example.com`, emailKey: `ipx${i}@example.com`, ipKey, sentAt: new Date(now - 60 * 1000), expiresAt: new Date(now), purgeAt: new Date(now + 3600 * 1000) })));
    assert.equal((await send('ip-new@example.com')).status, 429);
  });

  test('the answer is the same whether or not the email has an account', async () => {
    await signedIn(app, { email: 'member@example.com' });
    const a = await send('member@example.com');
    const b = await send('stranger@example.com');
    assert.equal(a.status, b.status);
    assert.deepEqual(a.body, b.body);
  });

  test('a signed-in customer with a confirmed email checks out without a code', async () => {
    const agent = await signedIn(app, { email: 'trusted@example.com' });
    assert.equal((await order('trusted@example.com', '', agent)).status, 400, 'not confirmed yet');
    await User.updateOne({ email: 'trusted@example.com' }, { $set: { emailVerified: true } });
    assert.equal((await order('trusted@example.com', '', agent)).status, 201);
    assert.equal((await order('someone@example.com', '', agent)).status, 400, 'a different email still needs its code');
  });

  test('confirming the code while signed in also confirms the account and brings in guest orders', async () => {
    await send('guestfirst@example.com');
    const proof = (await verify('guestfirst@example.com', codeFor('guestfirst@example.com'))).body.emailProof;
    const placed = await order('guestfirst@example.com', proof);
    const agent = await signedIn(app, { email: 'guestfirst@example.com' });
    await EmailCode.updateMany({ email: 'guestfirst@example.com' }, { $set: { sentAt: new Date(Date.now() - 31 * 1000) } });
    const again = await send('guestfirst@example.com', agent);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const v = await verify('guestfirst@example.com', codeFor('guestfirst@example.com'), agent);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal((await User.findOne({ email: 'guestfirst@example.com' })).emailVerified, true);
    const mine = await agent.get('/api/me/orders');
    assert.ok(JSON.stringify(mine.body).includes(placed.body.number));
  });

  test('in production with no email set up, checkout pauses instead of skipping the check', async () => {
    mail._setTestTransport(null);
    config.payments.requireEmailCode = true;
    try {
      assert.equal((await send('prod@example.com')).status, 503);
      const res = await order('prod@example.com', '');
      assert.equal(res.status, 503);
      assert.match(res.body.error, /paused/);
    } finally {
      config.payments.requireEmailCode = false;
      mail._setTestTransport(capture);
    }
  });
});
