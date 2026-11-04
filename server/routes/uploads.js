const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { limiters } = require('../middleware/security');
const { signUpload } = require('../services/cloudinary');
const { randomToken } = require('../lib/util');

const router = express.Router();

const FOLDERS = {
  references: { folder: 'artorabyjune/references', admin: false },
  reviews: { folder: 'artorabyjune/reviews', admin: false },
  memories: { folder: 'artorabyjune/memories', admin: false },
  products: { folder: 'artorabyjune/products', admin: true },
  sketches: { folder: 'artorabyjune/sketches', admin: true },
  site: { folder: 'artorabyjune/site', admin: true },
};

function resolveFolder(req, res) {
  const target = FOLDERS[req.body?.purpose];
  if (!target) {
    res.status(400).json({ error: 'Unknown upload type.' });
    return null;
  }
  if (target.admin && req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' });
    return null;
  }
  return target;
}

// Step 1: the browser asks how to upload. Cloudinary if configured, otherwise local disk.
router.post('/sign', limiters.upload, express.json(), (req, res) => {
  const target = resolveFolder(req, res);
  if (!target) return;
  if (config.features.cloudinary) return res.json(signUpload(target.folder));
  if (config.isProd && !process.env.ALLOW_LOCAL_UPLOADS) {
    return res.status(503).json({ error: 'Photo uploads aren’t set up yet. Please send references on Instagram for now.' });
  }
  res.json({ provider: 'local', purpose: req.body.purpose });
});

const SIGNATURES = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

// Local fallback (development / small installs). Accepts a compressed data URL from the browser.
router.post('/local', limiters.upload, express.json({ limit: '6mb' }), async (req, res) => {
  if (config.features.cloudinary || (config.isProd && !process.env.ALLOW_LOCAL_UPLOADS)) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const target = resolveFolder(req, res);
  if (!target) return;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
  if (!match) return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP image.' });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'That image is too large (max 4 MB).' });
  const kind = SIGNATURES.find((s) => s.test(buffer));
  if (!kind) return res.status(400).json({ error: 'That file doesn’t look like an image.' });
  const dir = path.join(config.uploadsDir, req.body.purpose);
  await fs.mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${randomToken(8)}.${kind.ext}`;
  await fs.writeFile(path.join(dir, name), buffer);
  res.status(201).json({ url: `/uploads/${req.body.purpose}/${name}` });
});

module.exports = router;
