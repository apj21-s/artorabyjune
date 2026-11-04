const mongoose = require('mongoose');

// A bag someone started checking out with. Used for one gentle reminder email if they don't finish.
const CartDraftSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  items: { type: [{ productId: mongoose.Schema.Types.ObjectId, qty: Number, _id: false }], default: [] },
  token: { type: String, required: true, unique: true },
  remindedAt: Date,
  orderPlacedAt: Date,
  unsubscribed: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.CartDraft || mongoose.model('CartDraft', CartDraftSchema);
