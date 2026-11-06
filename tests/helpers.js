// Shared test setup: an in-memory MongoDB, the seeded sample shop, and the Express app.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.INITIAL_ADMIN_EMAILS = 'june@example.com';
process.env.APP_URL = 'http://localhost:3000';
for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RESEND_API_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'SMTP_HOST', 'ADMIN_NOTIFY_EMAIL', 'SUPPORT_EMAIL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
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

module.exports = { start, stop, signedIn, request, address };
