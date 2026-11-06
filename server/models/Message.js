const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  topic: String,
  message: String,
  handled: { type: Boolean, default: false },
  // The same form sent twice (double tap, retry after a slow network) carries the same id.
  clientId: { type: String, unique: true, sparse: true },
  ipHash: String,
  spam: { type: Boolean, default: false },
  ownerEmail: { type: String, default: '' }, // sent | failed | skipped
  ackEmail: { type: String, default: '' },
}, { timestamps: true });

MessageSchema.index({ email: 1, createdAt: -1 });
MessageSchema.index({ ipHash: 1, createdAt: -1 });

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);
