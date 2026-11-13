const config = require('../config');

function notFoundApi(_req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err?.name === 'CastError') return res.status(404).json({ error: 'Not found.' });
  if (err?.code === 11000) return res.status(409).json({ error: 'That already exists.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
  const message = err.expose || status < 500 ? err.message : 'Something went wrong on our side. Please try again.';
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message, ...(err.expose && err.field ? { field: err.field } : {}) });
  res.status(status).send(config.isProd ? 'Something went wrong.' : message);
}

module.exports = { notFoundApi, errorHandler };
