// Concurrency and failure recovery for UPI payments: things that only go wrong under pressure.
const { test, before, after, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, signedIn, request, address, nextUtr, uploadProof, sendProof } = require('./helpers');
const { Product, Order, Coupon, GiftCard, EmailLog, PaymentRef } = require('../server/models');
const payments = require('../server/lib/payments');
const mail = require('../server/services/email');

let app;
let admin;
let admin2;
const product = (slug) => Product.findOne({ slug });
const checkout = async (slug, extra = {}, qty = 1) => {
  const p = await product(slug);
  const res = await request(app).post('/api/checkout').send({ items: [{ productId: String(p._id), qty }], name: 'Ravi', email: 'ravi@example.com', phone: '9876543210', address, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = await Order.findOne({ number: res.body.number });
  return { ...res.body, order, id: String(order._id) };
};
const pendingId = async (number) => (await Order.findOne({ number })).payments.find((p) => p.status === 'pending')._id;
const approve = (agent, id, pid, amount) => agent.post(`/api/admin/orders/${id}/payments/${pid}/approve`).send({ amount, bankCheck: { utrMatched: true } });

before(async () => {
  app = await start();
  admin = await signedIn(app, { email: 'june@example.com', name: 'June' });
  // A second admin, approved through the whitelist.
  await admin.put('/api/admin/admins').send({ approvedAdminEmails: ['helper@example.com'] });
  admin2 = await signedIn(app, { email: 'helper@example.com', name: 'Helper' });
  for (const slug of ['sunday-sun', 'city-of-lights', 'turtle-garden']) await Product.updateOne({ slug }, { $set: { stock: 50 } });
});
after(stop);
afterEach(() => { payments.hooks.afterClaim = null; });

describe('duplicate UTRs', () => {
  test('two orders sending the same UTR at the same moment: exactly one wins', async () => {
    const a = await checkout('sunday-sun');
    const b = await checkout('sunday-sun');
    const [pa, pb] = await Promise.all([uploadProof(app, a.number, a.token), uploadProof(app, b.number, b.token)]);
    const utr = nextUtr();
    const results = await Promise.all([
      request(app).post(`/api/orders/${a.number}/payment-proof`).send({ t: a.token, kind: 'full', utr, proof: { publicId: pa.publicId } }),
      request(app).post(`/api/orders/${b.number}/payment-proof`).send({ t: b.token, kind: 'full', utr, proof: { publicId: pb.publicId } }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await PaymentRef.countDocuments({ utr }), 1);
    const loser = results.find((r) => r.status === 409);
    assert.match(loser.body.error, /already linked/);
    // The losing order's screenshot is free again, so the customer can retry with the right UTR.
    const loserOrder = results[0].status === 409 ? a : b;
    const loserProof = results[0].status === 409 ? pa : pb;
    const retry = await sendProof(app, loserOrder.number, loserOrder.token, { proof: loserProof });
    assert.equal(retry.status, 201, JSON.stringify(retry.body));
  });

  test('a reservation left behind by a crash is repaired after a few minutes', async () => {
    const o = await checkout('sunday-sun');
    const utr = nextUtr();
    const ghost = await PaymentRef.create({ utr, orderId: o.order._id, paymentId: new (require('mongoose').Types.ObjectId)() });
    assert.equal((await sendProof(app, o.number, o.token, { utr })).status, 409, 'a fresh reservation is respected');
    await PaymentRef.collection.updateOne({ _id: ghost._id }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
    assert.equal((await sendProof(app, o.number, o.token, { utr })).status, 201);
  });

  test('a screenshot that uploaded fine can be reused when the submit itself failed', async () => {
    const o = await checkout('sunday-sun');
    const upload = await uploadProof(app, o.number, o.token);
    assert.equal((await sendProof(app, o.number, o.token, { proof: upload, utr: '123' })).status, 400);
    assert.equal((await sendProof(app, o.number, o.token, { proof: upload })).status, 201);
  });

  test('after five tries an order stops accepting proofs and June is told', async () => {
    const o = await checkout('sunday-sun');
    for (let i = 0; i < payments.MAX_PROOF_SUBMISSIONS; i += 1) {
      assert.equal((await sendProof(app, o.number, o.token)).status, 201, `try ${i + 1}`);
      await admin.post(`/api/admin/orders/${o.id}/payments/${await pendingId(o.number)}/reject`).send({ reason: 'Not received yet' });
    }
    const sixth = await sendProof(app, o.number, o.token);
    assert.equal(sixth.status, 429);
    assert.ok(await EmailLog.exists({ key: `admin-proof-limit:${o.id}` }));
  });
});

describe('approving safely', () => {
  test('two admins approving at the same time: one succeeds, stock is taken once', async () => {
    const before = (await product('city-of-lights')).stock;
    const o = await checkout('city-of-lights');
    await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    const results = await Promise.all([approve(admin, o.id, pid, o.order.total), approve(admin2, o.id, pid, o.order.total)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await product('city-of-lights')).stock, before - 1);
    const saved = await Order.findById(o.id);
    assert.equal(saved.payments.filter((p) => p.status === 'paid').length, 1);
    assert.equal(saved.amountPaid, saved.total);
  });

  test('a crash after the claim leaves the payment "approving"; finishing it later does everything exactly once', async () => {
    const coupon = (await Coupon.findOne({ code: 'BEGIN10' })).uses;
    const stock = (await product('turtle-garden')).stock;
    const o = await checkout('turtle-garden', { couponCode: 'BEGIN10' });
    await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    payments.hooks.afterClaim = async () => { throw new Error('simulated crash'); };
    const crashed = await approve(admin, o.id, pid, o.order.total);
    assert.equal(crashed.status, 500);
    payments.hooks.afterClaim = null;
    let saved = await Order.findById(o.id);
    assert.equal(saved.payments.id(pid).status, 'approving');
    assert.equal(saved.paymentStatus, 'unpaid');
    assert.equal((await approve(admin, o.id, pid, o.order.total)).status, 409, 'it can’t be approved a second time');

    const detail = (await admin.get(`/api/admin/orders/${o.id}`)).body.order;
    assert.equal(detail.payments[0].interrupted, false, 'not flagged until it has been stuck a little while');

    const fin = await admin.post(`/api/admin/orders/${o.id}/payments/${pid}/finish`);
    assert.equal(fin.status, 200, JSON.stringify(fin.body));
    assert.equal(fin.body.paymentStatus, 'paid');
    const again = await admin.post(`/api/admin/orders/${o.id}/payments/${pid}/finish`);
    assert.equal(again.body.already, true);
    saved = await Order.findById(o.id);
    assert.equal(saved.status, 'confirmed');
    assert.equal((await product('turtle-garden')).stock, stock - 1, 'stock taken once');
    assert.equal((await Coupon.findOne({ code: 'BEGIN10' })).uses, coupon + 1, 'coupon counted once');
    assert.equal(await EmailLog.countDocuments({ key: `payment:${o.id}:${pid}` }), 1, 'one receipt email');
  });

  test('gift cards bought in an order are issued once, however many times approval is finished', async () => {
    const card = await Product.create({ title: 'Gift card ₹500', slug: 'gift-500-race', price: 500, kind: 'giftcard', stock: 1000 });
    const o = await checkout('gift-500-race', { giftCard: { recipientEmail: 'friend@example.com', recipientName: 'Friend' } }, 2);
    await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    payments.hooks.afterClaim = async () => { throw new Error('simulated crash'); };
    await approve(admin, o.id, pid, o.order.total);
    payments.hooks.afterClaim = null;
    await Promise.all([payments.finishApproval(o.id, pid), payments.finishApproval(o.id, pid)]).catch(() => {});
    await payments.finishApproval(o.id, pid);
    assert.equal(await GiftCard.countDocuments({ sourceOrderId: o.id }), 2);
    assert.equal((await Order.findById(o.id)).paymentStatus, 'paid');
    await Product.deleteOne({ _id: card._id });
  });

  test('the daily job finishes approvals that have been stuck for a while', async () => {
    const o = await checkout('sunday-sun');
    await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    payments.hooks.afterClaim = async () => { throw new Error('simulated crash'); };
    await approve(admin, o.id, pid, o.order.total);
    payments.hooks.afterClaim = null;
    await Order.updateOne({ _id: o.id, 'payments._id': pid }, { $set: { 'payments.$.approvalStartedAt': new Date(Date.now() - 60 * 60 * 1000) } });
    const stats = (await admin.get('/api/admin/stats')).body;
    assert.ok(stats.interruptedApprovals >= 1);
    const { runPaymentMaintenance } = require('../server/services/maintenance');
    const r = await runPaymentMaintenance();
    assert.ok(r.finished >= 1);
    assert.equal((await Order.findById(o.id)).paymentStatus, 'paid');
  });

  test('stock sold out before approval: June is warned, and approving flags the order', async () => {
    const dog = await product('pawprint-picnic');
    await Product.updateOne({ _id: dog._id }, { $set: { stock: 1 } });
    const a = await checkout('pawprint-picnic');
    const b = await checkout('pawprint-picnic');
    await sendProof(app, a.number, a.token);
    await sendProof(app, b.number, b.token);
    await approve(admin, a.id, await pendingId(a.number), a.order.total);
    const queue = (await admin.get('/api/admin/payments').query({ q: b.number })).body.items;
    assert.equal(queue[0].lowStock, true);
    await approve(admin, b.id, await pendingId(b.number), b.order.total);
    assert.equal((await product('pawprint-picnic')).stock, 0, 'never negative');
    assert.match((await Order.findById(b.id)).internalNotes, /OVERSOLD/);
  });
});

describe('email failures', () => {
  test('if the receipt email fails, the payment is still saved and the email is retried later', async () => {
    let fail = true;
    const sent = [];
    mail._setTestTransport({ async sendMail(msg) { if (fail) throw new Error('Connection timeout'); sent.push(msg); return { messageId: 'x' }; } });
    try {
      // With an email provider on, checkout needs an email code; a signed-in, verified customer skips it.
      const customer = await signedIn(app, { email: 'verified.buyer@example.com', name: 'Vee' });
      await require('../server/models').User.updateOne({ email: 'verified.buyer@example.com' }, { $set: { emailVerified: true } });
      const sun = await product('sunday-sun');
      const res = await customer.post('/api/checkout').send({ items: [{ productId: String(sun._id), qty: 1 }], name: 'Vee', email: 'verified.buyer@example.com', phone: '9876543210', address });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const o = await Order.findOne({ number: res.body.number });
      await sendProof(app, o.number, o.accessToken);
      const pid = await pendingId(o.number);
      assert.equal((await approve(admin, String(o._id), pid, o.total)).status, 200);
      assert.equal((await Order.findById(o._id)).paymentStatus, 'paid');
      const log = await EmailLog.findOne({ key: `payment:${o._id}:${pid}` });
      assert.equal(log.status, 'failed');
      fail = false;
      await mail.processOutbox();
      assert.equal((await EmailLog.findOne({ key: `payment:${o._id}:${pid}` })).status, 'sent');
      assert.ok(sent.some((m) => m.to === 'verified.buyer@example.com' && /confirmed/i.test(m.subject)));
    } finally {
      mail._setTestTransport(null);
    }
  });
});
