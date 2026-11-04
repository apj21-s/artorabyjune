const rateLimit = require('express-rate-limit');
const config = require('../config');

const make = (windowMinutes, limit, message) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  limit: config.isTest ? 10_000 : limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: message },
});

const limiters = {
  auth: make(15, 20, 'Too many sign-in attempts. Please wait a few minutes.'),
  write: make(60, 40, 'Too many requests. Please try again a little later.'),
  upload: make(60, 60, 'Too many uploads. Please try again a little later.'),
  api: make(1, 300, 'Slow down a little, please.'),
};

// Blocks cross-site form posts from other origins (CSRF) on state-changing API calls.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // same-origin fetches from older browsers, curl, server-to-server
  const allowed = new Set([config.appUrl, `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`]);
  if (allowed.has(origin) || origin === `${req.protocol}://${req.get('host')}`) return next();
  return res.status(403).json({ error: 'Request blocked.' });
}

module.exports = { limiters, sameOrigin };
