const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  name: { type: String, required: true },
  city: String,
  rating: { type: Number, min: 1, max: 5, default: 5 },
  text: { type: String, required: true },
  photo: String,
  orderNumber: String,
  approved: { type: Boolean, default: false, index: true },
  featured: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.Review || mongoose.model('Review', ReviewSchema);
