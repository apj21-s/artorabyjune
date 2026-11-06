const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { User, Order } = require('../models');
const { startSession, endSession, syncRole } = require('../middleware/auth');
const { validate, z, str, email } = require('../middleware/validate');
const { limiters } = require('../middleware/security');
const { randomToken, sha256, safeReturnPath, safeEqual } = require('../lib/util');
const mail = require('../services/email');

const router = express.Router();

const password = () => z.string().min(8, 'Passwords need at least 8 characters.').max(200);

// Guest orders placed with this email become visible in the new account.
async function claimGuestOrders(user) {
  await Order.updateMany({ email: user.email, userId: { $exists: false } }, { $set: { userId: user._id } });
}

router.post('/register', limiters.auth, validate(z.object({
  name: str(80).min(1, 'Please tell us your name.'),
  email: email(),
  password: password(),
})), async (req, res) => {
  const { name, email: mailAddr, password: pw } = req.body;
  if (await User.exists({ email: mailAddr })) {
    return res.status(409).json({ error: 'An account with that email already exists. Try signing in.' });
  }
  const user = await User.create({
    name,
    email: mailAddr,
    passwordHash: await bcrypt.hash(pw, 12),
    profile: { displayName: name },
    lastLoginAt: new Date(),
  });
  await syncRole(user);
  await claimGuestOrders(user);
  startSession(res, user);
  res.status(201).json({ user: user.toPublic() });
});

router.post('/login', limiters.auth, validate(z.object({
  email: email(),
  password: z.string().max(200),
})), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  const ok = user?.passwordHash && await bcrypt.compare(req.body.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'That email and password don’t match.' });
  user.lastLoginAt = new Date();
  await syncRole(user);
  await user.save();
  await claimGuestOrders(user);
  startSession(res, user);
  res.json({ user: user.toPublic() });
});

router.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  await syncRole(req.user);
  res.json({ user: req.user.toPublic() });
});

router.post('/forgot', limiters.auth, validate(z.object({ email: email() })), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user) {
    const token = randomToken(24);
    user.resetTokenHash = sha256(token);
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
    await mail.send({ to: user.email, ...mail.templates.passwordReset(user, link), kind: 'password-reset' });
  }
  // Same answer either way so nobody can probe which emails have accounts.
  res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
});

router.post('/reset', limiters.auth, validate(z.object({
  email: email(),
  token: z.string().min(10).max(200),
  password: password(),
})), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  const valid = user?.resetTokenHash
    && user.resetTokenExpires > new Date()
    && safeEqual(user.resetTokenHash, sha256(req.body.token));
  if (!valid) return res.status(400).json({ error: 'That reset link has expired. Please request a new one.' });
  user.passwordHash = await bcrypt.hash(req.body.password, 12);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
  startSession(res, user);
  res.json({ user: user.toPublic() });
});

// Google sign-in (only active when GOOGLE_CLIENT_ID / SECRET are set).
const googleRedirect = () => `${config.appUrl}/api/auth/google/callback`;

router.get('/google/start', (req, res) => {
  if (!config.features.google) return res.redirect('/login?error=google-unavailable');
  const state = randomToken(16);
  const returnTo = safeReturnPath(req.query.returnTo);
  res.cookie('artora_oauth', JSON.stringify({ state, returnTo }), {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 10 * 60 * 1000,
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.google.clientId);
  url.searchParams.set('redirect_uri', googleRedirect());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/google/callback', async (req, res) => {
  let saved = {};
  try { saved = JSON.parse(req.cookies.artora_oauth || '{}'); } catch { saved = {}; }
  res.clearCookie('artora_oauth');
  if (!config.features.google || !req.query.code || !saved.state || !safeEqual(saved.state, String(req.query.state || ''))) {
    return res.redirect('/login?error=google-failed');
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(req.query.code),
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: googleRedirect(),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return res.redirect('/login?error=google-failed');
  const tokens = await tokenRes.json();
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) return res.redirect('/login?error=google-failed');
  const profile = await infoRes.json();
  if (!profile.email || profile.email_verified === false) return res.redirect('/login?error=google-failed');

  const mailAddr = profile.email.toLowerCase();
  let user = await User.findOne({ email: mailAddr });
  if (!user) {
    user = await User.create({
      email: mailAddr,
      name: profile.name || mailAddr.split('@')[0],
      googleId: profile.sub,
      profile: { displayName: profile.name || '' },
    });
  } else if (!user.googleId) {
    user.googleId = profile.sub;
  }
  user.lastLoginAt = new Date();
  await user.save();
  await syncRole(user);
  await claimGuestOrders(user);
  startSession(res, user);
  res.redirect(safeReturnPath(saved.returnTo) || '/account');
});

module.exports = router;
