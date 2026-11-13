// UPI payment proof: submit, review, approve, reject, partial and over-payments, refunds.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { start, stop, signedIn, request, address, nextUtr, uploadProof, sendProof, PNG } = require('./helpers');
const { Product, Order, EmailLog, PaymentRef, ProofUpload } = require('../server/models');
const config = require('../server/config');

let app;
let admin;
const product = (slug) => Product.findOne({ slug });
const checkout = async (slug, extra = {}) => {
  const p = await product(slug);
  const res = await request(app).post('/api/checkout').send({ items: [{ productId: String(p._id), qty: 1 }], name: 'Mira', email: 'mira@example.com', phone: '9876543210', address, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = await Order.findOne({ number: res.body.number });
  return { ...res.body, order, id: String(order._id) };
};
const view = async (number, token) => (await request(app).get(`/api/orders/${number}`).query({ t: token })).body;
const pendingId = async (number) => (await Order.findOne({ number })).payments.find((p) => p.status === 'pending')._id;
const approve = (id, pid, amount, extra = {}) => admin.post(`/api/admin/orders/${id}/payments/${pid}/approve`).send({ amount, bankCheck: { utrMatched: true, ...extra } });
const reject = (id, pid, reason = 'Screenshot unclear') => admin.post(`/api/admin/orders/${id}/payments/${pid}/reject`).send({ reason });
const emailed = (key) => EmailLog.exists({ key });

before(async () => {
  app = await start();
  admin = await signedIn(app, { email: 'june@example.com', name: 'June' });
  const content = await admin.get('/api/admin/content');
  assert.equal((await admin.put('/api/admin/content/site').send({ ...content.body.site, upiId: 'june@okhdfc', upiName: 'Artora by June' })).status, 200);
  for (const slug of ['sunday-sun', 'city-of-lights', 'turtle-garden']) await Product.updateOne({ slug }, { $set: { stock: 50 } });
});
after(stop);

describe('UPI payment details', () => {
  test('checkout returns the amount, a UPI link and a QR code, all from the server', async () => {
    const o = await checkout('sunday-sun');
    assert.equal(o.payment.provider, 'upi');
    assert.equal(o.payment.kind, 'full');
    assert.equal(o.payment.amount, o.order.total);
    assert.equal(o.payment.upiId, 'june@okhdfc');
    assert.match(o.payment.upiUri, new RegExp(`^upi://pay\\?pa=june%40okhdfc&pn=Artora%20by%20June&am=${o.order.total}\\.00&cu=INR&tn=${o.number}$`));
    assert.match(o.payment.qrSvg, /^<svg/);
    assert.equal(await emailed(`order-placed:${o.id}`), null, 'no "order confirmed" email before payment');
  });

  test('June can only save a real-looking UPI ID', async () => {
    const content = await admin.get('/api/admin/content');
    for (const bad of ['june', 'june@', 'a@b c', 'x@okhdfc&am=1']) {
      assert.equal((await admin.put('/api/admin/content/site').send({ ...content.body.site, upiId: bad })).status, 400, bad);
    }
  });
});

describe('sending proof', () => {
  test('a valid UTR and screenshot put the payment in review; customer and June are emailed', async () => {
    const o = await checkout('sunday-sun');
    const res = await sendProof(app, o.number, o.token);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.order.pendingPayment.utrEnd, res.utr.slice(-4));
    assert.equal(res.body.order.canPay, false);
    assert.ok(res.body.order.timeline.some((s) => s.key === 'checking' && s.state === 'current'));
    const saved = await Order.findById(o.id);
    const p = saved.payments[0];
    assert.equal(p.status, 'pending');
    assert.equal(p.expectedAmount, saved.total);
    assert.equal(saved.paymentStatus, 'unpaid', 'nothing counts as paid until June approves');
    assert.ok(await emailed(`proof:${o.id}:${p._id}`));
    assert.ok(await emailed(`admin-proof:${o.id}:${p._id}`));
    assert.ok(await PaymentRef.exists({ utr: res.utr }));
  });

  test('bad UTRs are refused', async () => {
    const o = await checkout('sunday-sun');
    for (const utr of ['12345', '1234567890123', '11111111111a', '000000000000', '999999999999']) {
      const res = await sendProof(app, o.number, o.token, { utr });
      assert.equal(res.status, 400, utr);
    }
  });

  test('a second proof while one is being checked is refused', async () => {
    const o = await checkout('sunday-sun');
    assert.equal((await sendProof(app, o.number, o.token)).status, 201);
    assert.equal((await sendProof(app, o.number, o.token)).status, 409);
  });

  test('wrong link token, wrong kind, and another order’s screenshot are refused', async () => {
    const a = await checkout('sunday-sun');
    const b = await checkout('sunday-sun');
    assert.equal((await request(app).post(`/api/orders/${a.number}/payment-proof/sign`).send({ t: 'nope' })).status, 404);
    assert.equal((await request(app).post(`/api/orders/${a.number}/payment-proof`).send({ t: 'nope', kind: 'full', utr: nextUtr(), proof: { publicId: 'x' } })).status, 404);
    assert.equal((await sendProof(app, a.number, a.token, { kind: 'deposit' })).status, 409);
    const bUpload = await uploadProof(app, b.number, b.token);
    const stolen = await sendProof(app, a.number, a.token, { proof: bUpload });
    assert.equal(stolen.status, 400, 'a screenshot uploaded for order B can’t be used on order A');
  });

  test('a made-up screenshot id is refused', async () => {
    const o = await checkout('sunday-sun');
    const res = await sendProof(app, o.number, o.token, { proof: { publicId: `${o.number}-notarealuploadid` } });
    assert.equal(res.status, 400);
  });
});

describe('June reviews payments', () => {
  test('approve: paid, confirmed, stock taken once, receipt emailed; approving twice is refused', async () => {
    const before = (await product('city-of-lights')).stock;
    const o = await checkout('city-of-lights');
    await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    assert.equal((await admin.post(`/api/admin/orders/${o.id}/payments/${pid}/approve`).send({ amount: o.order.total, bankCheck: {} })).status, 400, 'the UTR box must be ticked');
    const res = await approve(o.id, pid, o.order.total);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const saved = await Order.findById(o.id);
    assert.equal(saved.paymentStatus, 'paid');
    assert.equal(saved.status, 'confirmed');
    assert.equal(saved.payments[0].reviewedBy, 'june@example.com');
    assert.equal(saved.payments[0].bankCheck.utrMatched, true);
    assert.equal((await product('city-of-lights')).stock, before - 1);
    assert.ok(await emailed(`payment:${o.id}:${pid}`));
    assert.equal((await approve(o.id, pid, o.order.total)).status, 409);
    assert.equal((await reject(o.id, pid)).status, 409, 'a paid payment can’t be rejected');
    assert.equal((await product('city-of-lights')).stock, before - 1);
  });

  test('reject: the customer sees the reason and can resend the same UTR; a rejected payment can’t be approved', async () => {
    const o = await checkout('sunday-sun');
    const first = await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    assert.equal((await reject(o.id, pid, 'Screenshot unclear')).status, 200);
    assert.equal(await PaymentRef.exists({ utr: first.utr }), null, 'the UTR is released');
    assert.ok(await emailed(`payment-rejected:${o.id}:${pid}`));
    const v = await view(o.number, o.token);
    assert.equal(v.order.lastRejection.reason, 'Screenshot unclear');
    assert.equal(v.order.canPay, true);
    assert.ok(v.payment, 'payment details come back for another try');
    assert.equal((await approve(o.id, pid, o.order.total)).status, 409);

    const again = await sendProof(app, o.number, o.token, { utr: first.utr });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    const pid2 = await pendingId(o.number);
    assert.equal((await approve(o.id, pid2, o.order.total)).status, 200);
    assert.equal((await Order.findById(o.id)).paymentStatus, 'paid');
  });

  test('the same screenshot upload can’t be attached twice', async () => {
    const o = await checkout('sunday-sun');
    const upload = await uploadProof(app, o.number, o.token);
    assert.equal((await sendProof(app, o.number, o.token, { proof: upload })).status, 201);
    await reject(o.id, await pendingId(o.number));
    assert.equal((await sendProof(app, o.number, o.token, { proof: upload })).status, 409);
  });

  test('underpayment is recorded as partial, the rest stays due, then a top-up completes it', async () => {
    const o = await checkout('sunday-sun');
    await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    const short = o.order.total - 200;
    assert.equal((await approve(o.id, pid, short)).status, 400, 'a different amount needs an explicit confirmation');
    const res = await approve(o.id, pid, short, { amountConfirmed: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.paymentStatus, 'partially_paid');
    assert.deepEqual(res.body.due, { kind: 'full', amount: 200 });
    let saved = await Order.findById(o.id);
    assert.equal(saved.status, 'received', 'not confirmed until the full amount arrives');
    let v = await view(o.number, o.token);
    assert.equal(v.payment.amount, 200);

    await sendProof(app, o.number, o.token);
    assert.equal((await approve(o.id, await pendingId(o.number), 200)).status, 200);
    saved = await Order.findById(o.id);
    assert.equal(saved.paymentStatus, 'paid');
    assert.equal(saved.status, 'confirmed');
    v = await view(o.number, o.token);
    assert.equal(v.order.canPay, false);
  });

  test('overpayment is flagged; recording the refund settles it', async () => {
    const o = await checkout('sunday-sun');
    await sendProof(app, o.number, o.token);
    const res = await approve(o.id, await pendingId(o.number), o.order.total + 100, { amountConfirmed: true });
    assert.equal(res.body.paymentStatus, 'overpaid');
    const stats = (await admin.get('/api/admin/stats')).body;
    assert.ok(stats.refundsDue >= 1);
    assert.equal((await admin.post(`/api/admin/orders/${o.id}/refunds`).send({ amount: 100000 })).status, 400, 'can’t refund more than was kept');
    const r = await admin.post(`/api/admin/orders/${o.id}/refunds`).send({ amount: 100, note: 'Sent back the extra ₹100' });
    assert.equal(r.status, 200);
    assert.equal(r.body.paymentStatus, 'paid');
    assert.equal(r.body.amountPaid, o.order.total);
  });

  test('commission: approve sketch → deposit proof → approve → balance proof → approve', async () => {
    const placed = await request(app).post('/api/commissions').send({ tier: 'classic', story: 'Our two cats asleep on the sofa.', name: 'Tara', email: 'tara@example.com' });
    const { number, token } = placed.body;
    const id = String((await Order.findOne({ number }))._id);
    await admin.post(`/api/admin/orders/${id}/quote`).send({ price: 1299 });
    assert.equal((await sendProof(app, number, token, { kind: 'deposit' })).status, 409, 'nothing is due before the sketch is approved');
    const ap = await request(app).post(`/api/orders/${number}/approve`).send({ t: token });
    assert.equal(ap.body.payment.kind, 'deposit');
    assert.equal(ap.body.payment.amount, 650);
    assert.equal((await sendProof(app, number, token, { kind: 'deposit' })).status, 201);
    assert.equal((await admin.post(`/api/admin/orders/${id}/quote`).send({ price: 10 })).status, 409, 'no re-quote while a payment is in review');
    await approve(id, await pendingId(number), 650);
    let v = await view(number, token);
    assert.equal(v.order.paymentStatus, 'deposit_paid');
    assert.equal(v.order.status, 'confirmed');
    assert.deepEqual(v.order.due, { kind: 'balance', amount: 649 });
    assert.equal(v.payment.kind, 'balance');
    assert.equal((await sendProof(app, number, token, { kind: 'balance' })).status, 201);
    await approve(id, await pendingId(number), 649);
    v = await view(number, token);
    assert.equal(v.order.paymentStatus, 'paid');
    assert.equal(v.order.due, null);
  });

  test('cancelling closes a proof in review and frees its UTR; cancelling after payment raises a refund', async () => {
    const a = await checkout('sunday-sun');
    const sent = await sendProof(app, a.number, a.token);
    assert.equal((await admin.patch(`/api/admin/orders/${a.id}`).send({ status: 'cancelled', notify: false })).status, 200);
    const saved = await Order.findById(a.id);
    assert.equal(saved.payments[0].status, 'rejected');
    assert.equal(saved.payments[0].rejectionReason, 'Order cancelled');
    assert.equal(await PaymentRef.exists({ utr: sent.utr }), null);
    const b = await checkout('sunday-sun');
    assert.equal((await sendProof(app, b.number, b.token, { utr: sent.utr })).status, 201, 'the freed UTR can be used again');

    const c = await checkout('sunday-sun');
    await sendProof(app, c.number, c.token);
    await approve(c.id, await pendingId(c.number), c.order.total);
    await admin.patch(`/api/admin/orders/${c.id}`).send({ status: 'cancelled', notify: false });
    const detail = (await admin.get(`/api/admin/orders/${c.id}`)).body.order;
    assert.equal(detail.refundDue, c.order.total);
    const refunded = await admin.post(`/api/admin/orders/${c.id}/refunds`).send({ amount: c.order.total });
    assert.equal(refunded.body.paymentStatus, 'refunded');
  });
});

describe('admin payment queue', () => {
  test('lists waiting payments oldest first, searchable by UTR; counts on the overview', async () => {
    const o = await checkout('turtle-garden');
    const sent = await sendProof(app, o.number, o.token);
    const list = (await admin.get('/api/admin/payments').query({ status: 'pending' })).body.items;
    assert.ok(list.length >= 1);
    const dates = list.map((r) => new Date(r.submittedAt).getTime());
    assert.deepEqual(dates, [...dates].sort((x, y) => x - y));
    const found = (await admin.get('/api/admin/payments').query({ q: sent.utr })).body.items;
    assert.equal(found.length, 1);
    assert.equal(found[0].number, o.number);
    assert.equal(found[0].expectedAmount, o.order.total);
    const deposits = (await admin.get('/api/admin/payments').query({ kind: 'deposit' })).body.items;
    assert.ok(deposits.every((r) => r.kind === 'deposit'));
    const stats = (await admin.get('/api/admin/stats')).body;
    assert.ok(stats.paymentsToCheck >= 1);
    assert.ok(stats.oldestCheckAt);
  });

  test('the screenshot is only for admins and is never cached', async () => {
    const o = await checkout('turtle-garden');
    await sendProof(app, o.number, o.token);
    const pid = await pendingId(o.number);
    const img = await admin.get(`/api/admin/orders/${o.id}/payments/${pid}/proof`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.match(img.headers['cache-control'], /no-store/);
    assert.equal((await request(app).get(`/api/admin/orders/${o.id}/payments/${pid}/proof`)).status, 401);
    const customer = await signedIn(app, { email: 'peek@example.com' });
    assert.equal((await customer.get(`/api/admin/orders/${o.id}/payments/${pid}/proof`)).status, 403);
    // Customers never get the stored file name back.
    const v = await view(o.number, o.token);
    assert.ok(!JSON.stringify(v).includes('proofId'));
    assert.equal((await request(app).get(`/uploads/payments/${(await Order.findById(o.id)).payments[0].proofId}.img`)).status, 404);
  });
});

describe('Cloudinary uploads', () => {
  test('only a genuine, signed upload for this order is accepted', async () => {
    const saved = { ...config.cloudinary, on: config.features.cloudinary };
    Object.assign(config.cloudinary, { cloudName: 'demo', apiKey: 'key', apiSecret: 'shh-secret' });
    config.features.cloudinary = true;
    try {
      const o = await checkout('sunday-sun');
      const sign = await request(app).post(`/api/orders/${o.number}/payment-proof/sign`).send({ t: o.token });
      assert.equal(sign.status, 200);
      assert.equal(sign.body.type, 'authenticated');
      assert.equal(sign.body.allowed_formats, 'jpg,png,webp');
      assert.match(sign.body.public_id, new RegExp(`^artorabyjune/payments/${o.number}/`));
      const expectedSig = crypto.createHash('sha1').update(`allowed_formats=jpg,png,webp&public_id=${sign.body.public_id}&timestamp=${sign.body.timestamp}&type=authenticated` + 'shh-secret').digest('hex');
      assert.equal(sign.body.signature, expectedSig);
      assert.ok(!JSON.stringify(sign.body).includes('shh-secret'));

      const version = 1700000000;
      const real = crypto.createHash('sha1').update(`public_id=${sign.body.public_id}&version=${version}shh-secret`).digest('hex');
      const post = (proof) => request(app).post(`/api/orders/${o.number}/payment-proof`).send({ t: o.token, kind: 'full', utr: nextUtr(), proof });
      assert.equal((await post({ publicId: sign.body.public_id, version, signature: 'f'.repeat(40) })).status, 400, 'forged signature');
      const other = await checkout('sunday-sun');
      const otherSign = await request(app).post(`/api/orders/${other.number}/payment-proof/sign`).send({ t: other.token });
      const otherSig = crypto.createHash('sha1').update(`public_id=${otherSign.body.public_id}&version=${version}shh-secret`).digest('hex');
      assert.equal((await post({ publicId: otherSign.body.public_id, version, signature: otherSig })).status, 400, 'another order’s upload');
      const ok = await post({ publicId: sign.body.public_id, version, signature: real });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.ok(await ProofUpload.exists({ publicId: sign.body.public_id, attachedTo: { $exists: true } }));
    } finally {
      Object.assign(config.cloudinary, { cloudName: saved.cloudName, apiKey: saved.apiKey, apiSecret: saved.apiSecret });
      config.features.cloudinary = saved.on;
    }
  });
});

describe('old orders', () => {
  test('a Razorpay-era paid order still reads correctly and the migration keeps it paid', async () => {
    const sun = await product('sunday-sun');
    const legacy = await Order.create({
      number: 'AJ-9001', type: 'shop', name: 'Old', email: 'old@example.com', accessToken: 'legacy-token-123', status: 'delivered',
      items: [{ productId: sun._id, title: sun.title, price: 999, qty: 1 }], subtotal: 999, total: 999, amountPaid: 999, paymentStatus: 'paid', stockCommitted: true,
      payments: [
        { kind: 'full', amount: 999, method: 'razorpay', status: 'created', razorpayOrderId: 'order_old' },
        { kind: 'full', amount: 999, method: 'razorpay', status: 'paid', razorpayOrderId: 'order_old2', razorpayPaymentId: 'pay_old' },
      ],
    });
    const v = await view('AJ-9001', 'legacy-token-123');
    assert.equal(v.order.paymentStatus, 'paid');
    assert.equal(v.order.due, null);
    const { migrate } = require('../server/scripts/migrate-payments');
    const r1 = await migrate();
    const r2 = await migrate();
    assert.equal(r2.changed, 0, 'safe to run twice');
    assert.ok(r1.checked >= 1);
    const after = await Order.findById(legacy._id);
    assert.equal(after.paymentStatus, 'paid');
    assert.equal(after.amountPaid, 999);
  });

  test('a local screenshot file can’t be fetched through the public uploads folder', async () => {
    assert.ok(PNG.startsWith('data:image/png'));
    assert.notEqual((await request(app).get('/uploads/../private_uploads/payments/x.img')).status, 200);
  });
});
