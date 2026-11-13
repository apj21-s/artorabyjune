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

  // 'wasm-unsafe-eval' lets the self-hosted screenshot reader (Tesseract, /vendor/tesseract) compile
  // its WebAssembly. It does not allow eval() of JavaScript.
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
  if (config.plausibleDomain) scriptSrc.push('https://plausible.io');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': scriptSrc,
        'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
        'connect-src': ["'self'", 'https://api.cloudinary.com', 'https://api.postalpincode.in', ...(config.plausibleDomain ? ['https://plausible.io'] : [])],
        'worker-src': ["'self'", 'blob:'],
        'frame-src': ["'none'"],
        'form-action': ["'self'", 'https://accounts.google.com'],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());

  // Small JSON bodies everywhere, except the two local image-upload routes, which parse their
  // own body with a larger limit (and check the image bytes themselves).
  const json = express.json({ limit: '200kb' });
  const bigUpload = /^\/api\/(uploads\/local|orders\/[^/]+\/payment-proof\/local)$/;
  app.use((req, res, next) => (bigUpload.test(req.path) ? next() : json(req, res, next)));
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

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'artora-by-june', email: config.features.email, time: new Date().toISOString() }));

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
