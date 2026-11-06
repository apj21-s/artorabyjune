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
    supportEmail: (env.SUPPORT_EMAIL || env.GMAIL_USER || env.ADMIN_NOTIFY_EMAIL || '').trim().toLowerCase(),
    instagram: env.INSTAGRAM_HANDLE || 'artorabyjune',
  },
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
  },
  // Email. Pick one provider with env vars; no code change is needed to switch later.
  //  - Gmail (default, free, no domain): GMAIL_USER + GMAIL_APP_PASSWORD
  //  - Any SMTP host: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
  //  - Resend (needs your own domain): RESEND_API_KEY + RESEND_FROM_EMAIL
  email: {
    fromName: env.EMAIL_FROM_NAME || 'Artora by June',
    gmailUser: (env.GMAIL_USER || '').trim(),
    gmailPass: (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
    smtpHost: env.SMTP_HOST || '',
    smtpPort: Number(env.SMTP_PORT) || 465,
    smtpUser: env.SMTP_USER || '',
    smtpPass: env.SMTP_PASS || '',
    from: env.EMAIL_FROM || '',
  },
  resend: {
    apiKey: env.RESEND_API_KEY || '',
    from: env.RESEND_FROM_EMAIL || '',
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
  email: false, // set below
  google: Boolean(config.google.clientId && config.google.clientSecret),
};

config.emailProvider = (() => {
  const e = config.email;
  if (config.resend.apiKey && config.resend.from) return 'resend';
  if (e.smtpHost && e.smtpUser && e.smtpPass) return 'smtp';
  if (e.gmailUser && e.gmailPass) return 'gmail';
  return '';
})();
config.features.email = Boolean(config.emailProvider);

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
