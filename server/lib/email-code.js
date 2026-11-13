// Proves a checkout email can receive mail: we send a 6-digit code, the customer types it in.
// Stops fake or mistyped addresses (random@gmail.com) before an order exists.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { EmailCode } = require('../models');
const { sha256, safeEqual } = require('./util');
const mail = require('../services/email');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const PER_EMAIL_PER_HOUR = 5;
const PER_IP_PER_HOUR = 20;
const HOUR = 60 * 60 * 1000;
const PROOF_TTL = '30m';
const PROOF_AUDIENCE = 'checkout-email';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, expose: true, ...extra });

// Same inbox, different spellings: lower-case, no +tag, and Gmail ignores dots.
// Only used for counting sends; the code goes to the address exactly as typed.
function emailKey(address) {
  const [local = '', domain = ''] = String(address).trim().toLowerCase().split('@');
  let user = local.split('+')[0];
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
  if (gmail) user = user.replace(/\./g, '');
  return `${user}@${gmail ? 'gmail.com' : domain}`;
}

const ipKeyFor = (ip) => sha256(`${ip}|${config.jwtSecret}`).slice(0, 32);
const hashCode = (email, code) => sha256(`${code}|${String(email).toLowerCase()}|${config.jwtSecret}`);

// Can codes be sent at all? In production there's no way around it: no email, no checkout.
function codeMode() {
  if (mail.providerName()) return 'required';
  return config.payments.requireEmailCode ? 'unavailable' : 'off';
}

async function sendCode(address, ip) {
  const email = String(address).trim().toLowerCase();
  const mode = codeMode();
  if (mode === 'unavailable') throw fail(503, 'Checkout is paused for a moment while we fix our email. Please message June on Instagram or WhatsApp to order.');
  if (mode === 'off') return { sent: false, disabled: true };

  const key = emailKey(email);
  const ipKey = ipKeyFor(ip);
  const now = Date.now();
  const latest = await EmailCode.findOne({ emailKey: key }).sort({ sentAt: -1 });
  if (latest && now - latest.sentAt.getTime() < RESEND_WAIT_MS) {
    const wait = Math.ceil((RESEND_WAIT_MS - (now - latest.sentAt.getTime())) / 1000);
    throw fail(429, `Please wait ${wait} seconds before asking for another code.`, { retryAfter: wait });
  }
  const since = new Date(now - HOUR);
  const [byEmail, byIp] = await Promise.all([
    EmailCode.countDocuments({ emailKey: key, sentAt: { $gte: since } }),
    EmailCode.countDocuments({ ipKey, sentAt: { $gte: since } }),
  ]);
  if (byEmail >= PER_EMAIL_PER_HOUR || byIp >= PER_IP_PER_HOUR) {
    throw fail(429, 'That’s a lot of codes for one hour. Please try again a little later.');
  }

  // A new code replaces any earlier one for this address.
  await EmailCode.updateMany({ emailKey: key, usedAt: { $exists: false } }, { $set: { expiresAt: new Date(now) } });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await EmailCode.create({
    email,
    emailKey: key,
    ipKey,
    codeHash: hashCode(email, code),
    sentAt: new Date(now),
    expiresAt: new Date(now + CODE_TTL_MS),
    purgeAt: new Date(now + 2 * HOUR),
  });
  const result = await mail.send({ to: email, ...mail.templates.checkoutCode(code), kind: 'checkout-code' });
  if (!result.ok) throw fail(502, 'We couldn’t send the code just now. Check the address and try again in a minute.');
  return { sent: true };
}

async function verifyCode(address, code) {
  const email = String(address).trim().toLowerCase();
  const row = await EmailCode.findOne({ email, usedAt: { $exists: false } }).sort({ sentAt: -1 });
  const wrong = () => fail(400, 'That code doesn’t match. Check the latest email, or ask for a new code.', { field: 'code' });
  if (!row || row.expiresAt.getTime() < Date.now()) throw fail(400, 'That code has expired. Ask for a new one.', { field: 'code' });
  if (row.attempts >= MAX_ATTEMPTS) throw fail(429, 'Too many wrong tries. Ask for a new code.', { field: 'code' });
  // Count the try first (atomically), so parallel guesses can't get more than MAX_ATTEMPTS.
  const counted = await EmailCode.findOneAndUpdate(
    { _id: row._id, attempts: { $lt: MAX_ATTEMPTS }, usedAt: { $exists: false } },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!counted) throw fail(429, 'Too many wrong tries. Ask for a new code.', { field: 'code' });
  if (!safeEqual(hashCode(email, String(code).trim()), row.codeHash)) throw wrong();
  const used = await EmailCode.updateOne({ _id: row._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date(), expiresAt: new Date() } });
  if (!used.modifiedCount) throw wrong();
  return issueProof(email);
}

// A short-lived signed note that says "this email was proven". It has its own audience, so it
// can't be mistaken for a sign-in session and a session can't be used as one.
function issueProof(email) {
  return jwt.sign({ email, purpose: 'checkout-email' }, config.jwtSecret, { expiresIn: PROOF_TTL, audience: PROOF_AUDIENCE });
}

function checkProof(token, email) {
  if (!token) return false;
  try {
    const payload = jwt.verify(String(token), config.jwtSecret, { audience: PROOF_AUDIENCE });
    return payload.purpose === 'checkout-email' && payload.email === String(email).trim().toLowerCase();
  } catch {
    return false;
  }
}

module.exports = { sendCode, verifyCode, checkProof, issueProof, codeMode, emailKey, CODE_TTL_MS, RESEND_WAIT_MS, MAX_ATTEMPTS };
