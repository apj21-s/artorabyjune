const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  title: String,
  slug: String,
  image: String,
  price: Number,
  qty: Number,
  kind: { type: String, default: 'tote' },
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
  kind: { type: String, enum: ['full', 'deposit', 'balance'] },
  amount: Number,
  method: { type: String, enum: ['razorpay', 'manual', 'giftcard'], default: 'razorpay' },
  status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created' },
  razorpayOrderId: { type: String, index: true },
  razorpayPaymentId: String,
  note: String,
  at: { type: Date, default: Date.now },
}, { _id: true });

const HistorySchema = new mongoose.Schema({
  status: String,
  note: String,
  at: { type: Date, default: Date.now },
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  number: { type: String, unique: true, index: true },
  type: { type: String, enum: ['shop', 'commission'], required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  accessToken: { type: String, index: true }, // secret for guest links (track, approve, pay)

  name: String,
  email: { type: String, lowercase: true, trim: true, index: true },
  phone: String,

  items: { type: [ItemSchema], default: [] },

  commission: {
    tier: String,
    tierTitle: String,
    style: String,
    baseColour: String,
    occasion: String,
    story: String,
    include: String,
    moods: [String],
    references: [String],
    deadline: Date,
    quoteMessage: String,
    sketchImage: String,
    quotedAt: Date,
    approvedAt: Date,
    changeRequests: [{ message: String, at: { type: Date, default: Date.now } }],
  },

  gift: {
    isGift: { type: Boolean, default: false },
    note: String,
    wrap: { type: Boolean, default: false },
  },

  shippingAddress: {
    name: String,
    phone: String,
    line1: String,
    line2: String,
    city: String,
    state: String,
    pincode: String,
  },

  couponCode: String,
  bundleDiscount: { type: Number, default: 0 },
  giftCardCode: String,
  giftCardAmount: { type: Number, default: 0 },
  giftCardRecipient: { email: String, name: String, message: String },
  giftCardsIssued: { type: Boolean, default: false },
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  shippingFee: { type: Number, default: 0 },
  giftWrapFee: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  depositAmount: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'deposit_paid', 'paid', 'refunded'],
    default: 'unpaid',
    index: true,
  },
  payments: { type: [PaymentSchema], default: [] },
  stockCommitted: { type: Boolean, default: false },

  status: { type: String, default: 'received', index: true },
  history: { type: [HistorySchema], default: [] },
  tracking: {
    courier: String,
    number: String,
    url: String,
  },
  internalNotes: String,
  reviewRequestedAt: Date,
}, { timestamps: true });

OrderSchema.virtual('balanceDue').get(function balanceDue() {
  return Math.max(0, (this.total || 0) - (this.amountPaid || 0));
});

module.exports = mongoose.models.Order || mongoose.model('Order', OrderSchema);
