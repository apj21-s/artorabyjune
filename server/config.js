require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function list(value) {
  return String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

const config = {
  isProd,
  isTest,
  port: Number(env.PORT) || 3000,
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/artora_by_june',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  cookieName: env.COOKIE_NAME || 'artora_session',
  initialAdminEmails: list(env.INITIAL_ADMIN_EMAILS),
  brand: {
    name: 'Artora by June',
    supportEmail: env.SUPPORT_EMAIL || 'hello@artorabyjune.com',
    instagram: env.INSTAGRAM_HANDLE || 'artorabyjune',
  },
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
  },
  resend: {
    apiKey: env.RESEND_API_KEY || '',
    from: env.RESEND_FROM_EMAIL || 'Artora by June <orders@artorabyjune.com>',
  },
  adminNotifyEmail: env.ADMIN_NOTIFY_EMAIL || '',
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  plausibleDomain: env.PLAUSIBLE_DOMAIN || '',
  uploadsDir: env.UPLOADS_DIR || require('path').join(__dirname, '..', 'uploads'),
};

config.features = {
  razorpay: Boolean(config.razorpay.keyId && config.razorpay.keySecret),
  cloudinary: Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret),
  email: Boolean(config.resend.apiKey),
  google: Boolean(config.google.clientId && config.google.clientSecret),
};

function validate() {
  const problems = [];
  if (isProd) {
    if (!env.MONGODB_URI) problems.push('MONGODB_URI is required in production.');
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /replace|change-me/i.test(env.JWT_SECRET)) {
      problems.push('JWT_SECRET must be a random string of at least 32 characters.');
    }
    if (!env.APP_URL || !/^https:\/\//.test(env.APP_URL)) problems.push('APP_URL must be your https:// site address.');
  }
  return problems;
}

config.validate = validate;

module.exports = config;
