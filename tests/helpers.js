// Shared test setup: an in-memory MongoDB, the seeded sample shop, and the Express app.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.INITIAL_ADMIN_EMAILS = 'june@example.com';
process.env.APP_URL = 'http://localhost:3000';
process.env.PRIVATE_UPLOADS_DIR = require('path').join(require('os').tmpdir(), `artora-test-private-${process.pid}`);
for (const k of ['REQUIRE_CHECKOUT_EMAIL_CODE', 'RESEND_API_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'SMTP_HOST', 'ADMIN_NOTIFY_EMAIL', 'SUPPORT_EMAIL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
  process.env[k] = '';
}

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

async function start() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('artora-test'));
  await require('../server/scripts/seed').seed();
  const { createApp } = require('../server/app');
  return createApp();
}

async function stop() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

// A supertest agent keeps the session cookie between requests, like a browser.
async function signedIn(app, { email, password = 'a-good-password', name = 'Test' }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ name, email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

const address = {
  name: 'Asha Rao', phone: '9876543210', line1: '12 Lake Road', city: 'Pune', state: 'Maharashtra', pincode: '411001',
};

// A real 1×1 PNG, enough to pass the image checks.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// A fresh, valid 12-digit UTR each time.
let utrSeq = 0;
function nextUtr() {
  utrSeq += 1;
  return `3${String(Date.now() % 1e6).padStart(6, '0')}${String(utrSeq).padStart(5, '0')}`.slice(0, 12);
}

// Uploads a screenshot for an order the way the browser does (local storage in tests).
async function uploadProof(app, number, token) {
  const sign = await request(app).post(`/api/orders/${number}/payment-proof/sign`).send({ t: token });
  if (sign.status !== 200) return { status: sign.status, body: sign.body };
  const up = await request(app).post(`/api/orders/${number}/payment-proof/local`).send({ t: token, publicId: sign.body.publicId, data: PNG });
  if (up.status !== 201) throw new Error(`upload failed: ${up.status} ${JSON.stringify(up.body)}`);
  return { status: 201, publicId: sign.body.publicId };
}

async function sendProof(app, number, token, { kind = 'full', utr = nextUtr(), proof } = {}) {
  const p = proof || await uploadProof(app, number, token);
  if (!p.publicId) return { status: p.status, body: p.body, utr };
  const res = await request(app).post(`/api/orders/${number}/payment-proof`).send({ t: token, kind, utr, proof: { publicId: p.publicId } });
  res.utr = utr;
  return res;
}

module.exports = { start, stop, signedIn, request, address, PNG, nextUtr, uploadProof, sendProof };
