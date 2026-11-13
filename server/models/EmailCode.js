const mongoose = require('mongoose');

// One-time codes that prove a checkout email can receive mail (stops fake or mistyped addresses).
// Only a hash of the code is stored. Rows expire on their own; `sentAt` rows are also used to
// count sends per email and per IP, so the limits hold across serverless instances.
const EmailCodeSchema = new mongoose.Schema({
  email: { type: String, required: true },
  emailKey: { type: String, required: true, index: true }, // normalised for rate limits
  ipKey: { type: String, index: true },
  purpose: { type: String, default: 'checkout' },
  codeHash: String,
  attempts: { type: Number, default: 0 },
  usedAt: Date,
  sentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  // Kept a little longer than the code itself so hourly send limits can be counted.
  purgeAt: { type: Date, required: true },
});

EmailCodeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.EmailCode || mongoose.model('EmailCode', EmailCodeSchema);
