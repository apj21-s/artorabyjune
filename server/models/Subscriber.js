const mongoose = require('mongoose');

const SubscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  kind: { type: String, enum: ['newsletter', 'restock'], default: 'newsletter' },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productTitle: String,
  notifiedAt: Date,
}, { timestamps: true });

SubscriberSchema.index({ email: 1, kind: 1, productId: 1 }, { unique: true });

module.exports = mongoose.models.Subscriber || mongoose.model('Subscriber', SubscriberSchema);
