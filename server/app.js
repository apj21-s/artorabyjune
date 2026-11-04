const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { limiters, sameOrigin } = require('./middleware/security');
const { notFoundApi, errorHandler } = require('./middleware/errors');
const pages = require('./routes/pages');
const orders = require('./routes/orders');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render / nginx / Cloudflare

  const scriptSrc = ["'self'", 'https://checkout.razorpay.com'];
  if (config.plausibleDomain) scriptSrc.push('https://plausible.io');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': scriptSrc,
        'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://*.razorpay.com'],
        'connect-src': ["'self'", 'https://api.cloudinary.com', 'https://lumberjack.razorpay.com', 'https://api.postalpincode.in', ...(config.plausibleDomain ? ['https://plausible.io'] : [])],
        'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
        'form-action': ["'self'", 'https://accounts.google.com'],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());

  // Razorpay webhook needs the untouched body to check its signature — mount before JSON parsing.
  app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), orders.webhookHandler);

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  // Static files: only /public is ever served.
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    index: false,
    maxAge: config.isProd ? '7d' : 0,
    setHeaders(res, filePath) {
      if (/\.(woff2?|png|jpe?g|webp|svg|ico)$/.test(filePath) && config.isProd) res.setHeader('Cache-Control', `public, max-age=${oneYear / 1000}`);
    },
  }));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', fallthrough: false, dotfiles: 'deny' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'artora-by-june', time: new Date().toISOString() }));

  app.use('/api', limiters.api, sameOrigin, loadUser);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/me', require('./routes/me'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/uploads', require('./routes/uploads'));
  app.use('/api', require('./routes/public'));
  app.use('/api', orders);
  app.use('/api', notFoundApi);

  app.use(pages.router);
  app.use(pages.notFoundPage);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
