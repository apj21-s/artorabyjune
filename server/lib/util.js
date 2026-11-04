const crypto = require('crypto');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function inr(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

// Only allow redirects back into this site (prevents open-redirect phishing).
function safeReturnPath(value) {
  const path = String(value || '/');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
  return path;
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeHtml, slugify, randomToken, sha256, safeEqual, inr, safeReturnPath, escapeRegex };
