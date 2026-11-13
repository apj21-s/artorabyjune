const mongoose = require('mongoose');

const CouponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  kind: { type: String, enum: ['percent', 'flat'], default: 'percent' },
  value: { type: Number, required: true, min: 0 },
  minOrder: { type: Number, default: 0 },
  appliesTo: { type: String, enum: ['all', 'shop', 'commission'], default: 'all' },
  expiresAt: Date,
  usageLimit: { type: Number, default: 0 }, // 0 = unlimited
  uses: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  note: String,
  // Orders already counted in `uses`, so a retried approval never counts twice.
  usedByOrders: { type: [String], default: [], select: false },
}, { timestamps: true });

module.exports = mongoose.models.Coupon || mongoose.model('Coupon', CouponSchema);
