const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, signedIn, request } = require('./helpers');
const { Message, EmailLog, Order } = require('../server/models');
const mail = require('../server/services/email');

let app;
let admin;
let outbox = [];
let failNext = 0;

// Stands in for Gmail: records what would be sent, and can be told to fail.
const capture = {
  async sendMail(msg) {
    if (failNext > 0) { failNext -= 1; throw new Error('Connection timeout'); }
    outbox.push(msg);
    return { messageId: `<${outbox.length}@test>` };
  },
};

const enquiry = (body = {}) => request(app).post('/api/contact').send({
  name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', topic: 'A commission',
  message: 'Could you paint our cat Mango on a tote?', clientId: `cid-${Math.random().toString(36).slice(2, 12)}`, ...body,
});

before(async () => {
  app = await start();
  admin = await signedIn(app, { email: 'june@example.com', name: 'June' });
  mail._setTestTransport(capture);
});
after(async () => { mail._setTestTransport(null); await stop(); });
beforeEach(async () => { outbox = []; failNext = 0; await Message.deleteMany({}); });

describe('enquiries', () => {
  test('owner gets the enquiry with Reply-To set to the customer; customer gets a copy', async () => {
    const res = await enquiry();
    assert.equal(res.status, 201);
    assert.equal(res.body.ack, true);
    const owner = outbox.find((m) => m.to === 'june@example.com');
    const ack = outbox.find((m) => m.to === 'asha@example.com');
    assert.ok(owner && ack, JSON.stringify(outbox.map((m) => m.to)));
    assert.match(owner.subject, /New enquiry · A commission · Asha Rao/);
    assert.match(owner.replyTo, /asha@example\.com/);
    assert.match(owner.html, /9876543210/);
    assert.match(owner.text, /Could you paint our cat Mango/);
    assert.match(ack.html, /Could you paint our cat Mango/);
    // Logo and hills are embedded, not loaded from the website.
    assert.match(owner.html, /src="cid:mark@artora"/);
    assert.deepEqual(owner.attachments.map((a) => a.cid).sort(), ['hills@artora', 'mark@artora']);
    const msg = await Message.findOne();
    assert.equal(msg.ownerEmail, 'sent');
    assert.equal(msg.ackEmail, 'sent');
  });

  test('customer text is escaped in the email', async () => {
    await enquiry({ message: 'Hello <script>alert(1)</script> studio' });
    assert.ok(outbox.every((m) => !m.html.includes('<script>')));
  });

  test('the same submission twice sends once', async () => {
    const clientId = 'cid-double-tap-1';
    await enquiry({ clientId });
    await enquiry({ clientId });
    await enquiry({ clientId: 'cid-other-id-2' }); // same text within 10 minutes
    assert.equal(await Message.countDocuments(), 1);
    assert.equal(outbox.length, 2);
  });

  test('honeypot, instant submits and link spam send no email', async () => {
    assert.equal((await enquiry({ website: 'http://spam' })).status, 400);
    assert.equal((await enquiry({ startedAt: Date.now() - 500 })).status, 201);
    assert.equal((await enquiry({ message: 'buy http://a.io http://b.io http://c.io http://d.io now' })).status, 201);
    assert.equal(outbox.length, 0);
    assert.equal(await Message.countDocuments({ spam: true }), 2);
  });

  test('one visitor is limited to 5 notes an hour', async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await enquiry({ message: `Note number ${i} about a tote` })).status, 201);
    assert.equal((await enquiry({ message: 'One more note please' })).status, 429);
  });

  test('a delivery failure still saves the note and is retried', async () => {
    failNext = 1;
    const res = await enquiry();
    assert.equal(res.status, 201);
    const msg = await Message.findOne();
    const failed = await EmailLog.findOne({ status: 'failed', key: { $in: [`enquiry-owner:${msg._id}`, `enquiry-ack:${msg._id}`] } });
    assert.ok(failed);
    const r = await mail.processOutbox();
    assert.equal(r.sent, 1);
    assert.equal((await EmailLog.findById(failed._id)).status, 'sent');
  });
});

describe('outbox', () => {
  test('the same key never sends twice', async () => {
    const t = mail.templates.adminAlert('Hello', ['x']);
    await mail.send({ to: 'a@example.com', ...t, key: 'unit:1' });
    const again = await mail.send({ to: 'a@example.com', ...t, key: 'unit:1' });
    assert.equal(again.duplicate, true);
    assert.equal(outbox.length, 1);
  });

  test('order emails go once even if the trigger repeats', async () => {
    const res = await request(app).post('/api/commissions').send({ tier: 'classic', story: 'Our garden in spring, with the swing.', name: 'Ira', email: 'ira@example.com' });
    assert.equal(res.status, 201);
    assert.equal(outbox.filter((m) => m.to === 'ira@example.com').length, 1);
    assert.equal(outbox.filter((m) => m.to === 'june@example.com').length, 1);
    const order = await Order.findOne({ number: res.body.number });
    await mail.send({ to: order.email, ...mail.templates.commissionReceived(order), key: `commission-received:${order._id}` });
    assert.equal(outbox.filter((m) => m.to === 'ira@example.com').length, 1);
  });

  test('password reset links are not kept after sending', async () => {
    await request(app).post('/api/auth/forgot').send({ email: 'june@example.com' });
    const row = await EmailLog.findOne({ kind: 'password-reset' }).lean();
    assert.equal(row.status, 'sent');
    assert.equal(row.html, undefined);
  });

  test('plain-text version is readable', () => {
    const text = mail.htmlToText(mail.templates.restock('x@example.com', { title: 'Sunday Sun', slug: 'sunday-sun' }).html);
    assert.match(text, /Sunday Sun is back\./);
    assert.match(text, /See it now \(http:\/\/localhost:3000\/shop\/sunday-sun\)/);
    assert.ok(!/<|style=/.test(text));
  });
});

describe('admin', () => {
  test('email log, test email and retry', async () => {
    const log = await admin.get('/api/admin/emails');
    assert.equal(log.status, 200);
    const t = await admin.post('/api/admin/emails/test').send({});
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(outbox.at(-1).to, 'june@example.com');
    failNext = 1;
    await mail.send({ to: 'z@example.com', ...mail.templates.adminAlert('Retry me', ['x']), key: 'unit:retry' });
    const row = await EmailLog.findOne({ key: 'unit:retry' });
    assert.equal(row.status, 'failed');
    assert.equal((await admin.post(`/api/admin/emails/${row._id}/retry`).send({})).status, 200);
    assert.equal((await EmailLog.findById(row._id)).status, 'sent');
  });

  test('customers cannot see the email log', async () => {
    assert.equal((await request(app).get('/api/admin/emails')).status, 401);
  });
});
