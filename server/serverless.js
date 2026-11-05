// Shared start-up for Vercel. A serverless function can't quit and restart like the
// normal server, so we connect to the database once, reuse it, and retry if it fails.
const mongoose = require('mongoose');
const config = require('./config');
const { seedContent } = require('./lib/content');

let ready = null;

function connect() {
  if (!ready) {
    ready = (async () => {
      const problems = config.validate();
      if (problems.length) throw new Error(`Artora by June cannot start: ${problems.join(' ')}`);
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
      await seedContent();
    })().catch((error) => {
      ready = null; // try again on the next request
      throw error;
    });
  }
  return ready;
}

function startupFailed(res, error) {
  console.error('[startup]', error);
  res.statusCode = 503;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Retry-After', '30');
  res.end('<!doctype html><meta charset="utf-8"><title>Artora by June</title>'
    + '<p style="font:16px/1.5 system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">'
    + 'The shop is taking a short break. Please try again in a minute.</p>');
}

module.exports = { connect, startupFailed };
