const crypto = require('crypto');
const config = require('../config');
const { safeEqual } = require('../lib/util');

const API = 'https://api.razorpay.com/v1';

function enabled() {
  return config.features.razorpay;
}

async function createOrder({ amount, receipt, notes = {} }) {
  if (!enabled()) throw Object.assign(new Error('Online payments are not set up yet.'), { status: 503, expose: true });
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt, notes }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[razorpay] order create failed', res.status, text);
    throw Object.assign(new Error('Could not start the payment. Please try again.'), { status: 502, expose: true });
  }
  return res.json();
}

function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

module.exports = { enabled, createOrder, verifyPaymentSignature, verifyWebhookSignature };
