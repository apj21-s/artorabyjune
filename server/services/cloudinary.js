const crypto = require('crypto');
const config = require('../config');

const API = 'https://api.cloudinary.com/v1_1';

// Cloudinary's request signature: params sorted by name, joined as k=v&k=v, then the API secret,
// hashed with SHA-1 (the same scheme the official SDK uses; see its utils.api_sign_request).
function sign(params) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + config.cloudinary.apiSecret).digest('hex');
}

// Signed direct-to-Cloudinary uploads: the browser uploads, the secret never leaves the server.
function signUpload(folder) {
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, timestamp };
  return {
    provider: 'cloudinary',
    timestamp,
    signature: sign(params),
    folder,
    apiKey: config.cloudinary.apiKey,
    cloudName: config.cloudinary.cloudName,
  };
}

// Payment screenshots are private: stored as `authenticated`, so the image can't be opened by
// URL. The public_id is fixed by the server, so the browser can only upload to that one slot.
const PROOF_FORMATS = 'jpg,png,webp';
function signPrivateUpload(publicId) {
  const params = {
    allowed_formats: PROOF_FORMATS,
    public_id: publicId,
    timestamp: Math.round(Date.now() / 1000),
    type: 'authenticated',
  };
  return {
    provider: 'cloudinary',
    ...params,
    signature: sign(params),
    apiKey: config.cloudinary.apiKey,
    cloudName: config.cloudinary.cloudName,
  };
}

// Cloudinary signs every upload response with the API secret (SDK: verify_api_response_signature,
// "signature version 1": public_id=…&version=… + secret, SHA-1). A match proves the file really was
// uploaded to our account, with this public_id, and wasn't made up by the browser.
function verifyUploadResponse({ publicId, version, signature }) {
  if (!publicId || !version || !signature) return false;
  const expected = crypto.createHash('sha1').update(`public_id=${publicId}&version=${version}${config.cloudinary.apiSecret}`).digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Fetches a private image server-side (SDK: private_download_url) so the admin can see it
// without the image ever having a public address.
async function fetchPrivateImage(publicId, format = 'jpg') {
  const params = {
    expires_at: Math.round(Date.now() / 1000) + 120,
    format,
    public_id: publicId,
    timestamp: Math.round(Date.now() / 1000),
    type: 'authenticated',
  };
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), signature: sign(params), api_key: config.cloudinary.apiKey });
  const res = await fetch(`${API}/${encodeURIComponent(config.cloudinary.cloudName)}/image/download?${qs}`);
  if (!res.ok) throw Object.assign(new Error('Couldn’t load that screenshot from storage.'), { status: 502, expose: true });
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

async function destroyPrivate(publicId) {
  const params = { public_id: publicId, timestamp: Math.round(Date.now() / 1000), type: 'authenticated', invalidate: 'true' };
  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), signature: sign(params), api_key: config.cloudinary.apiKey });
  const res = await fetch(`${API}/${encodeURIComponent(config.cloudinary.cloudName)}/image/destroy`, { method: 'POST', body });
  return res.ok;
}

module.exports = { signUpload, signPrivateUpload, verifyUploadResponse, fetchPrivateImage, destroyPrivate, sign, PROOF_FORMATS };
