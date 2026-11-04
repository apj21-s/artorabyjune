const jwt = require('jsonwebtoken');
const config = require('../config');
const { User, Content } = require('../models');

const SESSION_DAYS = 14;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function startSession(res, user) {
  const token = jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(config.cookieName, token, cookieOptions());
}

function endSession(res) {
  res.clearCookie(config.cookieName, { ...cookieOptions(), maxAge: undefined });
}

async function approvedAdminEmails() {
  const security = await Content.findOne({ key: 'security' }).lean();
  const emails = new Set(config.initialAdminEmails);
  (security?.data?.approvedAdminEmails || []).forEach((e) => emails.add(String(e).toLowerCase()));
  return emails;
}

// Keeps a user's role in step with the admin email whitelist.
async function syncRole(user) {
  const approved = await approvedAdminEmails();
  const role = approved.has(user.email) ? 'admin' : 'customer';
  if (user.role !== role) {
    user.role = role;
    await user.save();
  }
  return user;
}

async function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[config.cookieName];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.user = await User.findById(payload.sub);
    } catch {
      req.user = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

module.exports = { startSession, endSession, loadUser, requireAuth, requireAdmin, syncRole, approvedAdminEmails };
