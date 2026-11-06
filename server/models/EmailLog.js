const mongoose = require('mongoose');

// Outbox: one row per email. `key` makes each notification send at most once;
// failed rows are retried by the daily cron or from Admin → Messages.
const EmailLogSchema = new mongoose.Schema({
  key: { type: String, unique: true, sparse: true },
  kind: String,
  to: String,
  replyTo: String,
  subject: String,
  html: String,
  text: String,
  headers: { type: Object, default: undefined },
  status: { type: String, enum: ['queued', 'sending', 'sent', 'failed', 'skipped'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  lastError: String,
  provider: String,
  messageId: String,
  sentAt: Date,
}, { timestamps: true });

EmailLogSchema.index({ status: 1, createdAt: -1 });
// Rendered copies are kept for 60 days, then removed by MongoDB.
EmailLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.models.EmailLog || mongoose.model('EmailLog', EmailLogSchema);
