const mongoose = require('mongoose');

// Store credit: bought as a gift card in the shop, or issued by hand from the admin (e.g. a refund).
const GiftCardSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  initialAmount: { type: Number, required: true, min: 1 },
  balance: { type: Number, required: true, min: 0 },
  purchaserEmail: String,
  recipientEmail: String,
  recipientName: String,
  message: String,
  orderNumber: String,
  active: { type: Boolean, default: true },
  expiresAt: Date,
  note: String,
  // Bought in the shop: which order and which card in that order. Unique, so a retried
  // approval can never issue the same card twice.
  sourceOrderId: String,
  sourceIndex: Number,
  // Orders that spent from this card, so a retried approval never spends twice.
  redeemedByOrders: { type: [String], default: [], select: false },
}, { timestamps: true });

GiftCardSchema.index({ sourceOrderId: 1, sourceIndex: 1 }, { unique: true, partialFilterExpression: { sourceOrderId: { $type: 'string' } } });

module.exports = mongoose.models.GiftCard || mongoose.model('GiftCard', GiftCardSchema);
