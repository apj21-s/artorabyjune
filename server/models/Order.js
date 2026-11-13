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

// One payment against an order.
// Lifecycle (UPI proof): pending → approving → paid, or pending → rejected.
// 'approving' means June pressed Approve and the side effects (stock, coupon, gift cards, emails)
// are being applied; finishApproval() can safely re-run it after a crash.
// 'created' / 'failed' and the razorpay* fields only exist on old Razorpay-era records.
const PAYMENT_STATUSES = ['pending', 'approving', 'paid', 'rejected', 'created', 'failed'];
const PaymentSchema = new mongoose.Schema({
  kind: { type: String, enum: ['full', 'deposit', 'balance'] },
  amount: Number, // what was actually received (set when approved)
  expectedAmount: Number, // what was due when the customer submitted proof
  method: { type: String, enum: ['upi', 'manual', 'giftcard', 'razorpay'], default: 'upi' },
  status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
  utr: String,
  proofId: String, // private Cloudinary public_id (or local file name) of the screenshot
  proofProvider: { type: String, enum: ['cloudinary', 'local'] },
  submittedAt: Date,
  approvalStartedAt: Date,
  reviewedAt: Date,
  reviewedBy: String, // admin email
  rejectionReason: String,
  bankCheck: {
    amount: Number,
    date: String,
    sender: String,
    utrMatched: Boolean,
  },
  razorpayOrderId: { type: String, index: true },
  razorpayPaymentId: String,
  note: String,
  at: { type: Date, default: Date.now },
}, { _id: true });

const RefundSchema = new mongoose.Schema({
  amount: Number,
  note: String,
  by: String,
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
  // Where the order came from: the website, or entered by June from a DM / chat / in person.
  source: { type: String, enum: ['website', 'instagram', 'whatsapp', 'in_person', 'phone', 'other'], default: 'website' },
  sourceHandle: String,
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
  // Derived money state; only server/lib/money.js recomputeMoney() writes it.
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partially_paid', 'deposit_paid', 'paid', 'overpaid', 'refunded'],
    default: 'unpaid',
    index: true,
  },
  payments: { type: [PaymentSchema], default: [] },
  refunds: { type: [RefundSchema], default: [] },
  proofSubmissions: { type: Number, default: 0 },
  emailVerified: { type: Boolean, default: false }, // the checkout email was proven with a code
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

OrderSchema.index({ 'payments.status': 1, 'payments.submittedAt': 1 });
OrderSchema.index({ 'payments.utr': 1 });

OrderSchema.virtual('balanceDue').get(function balanceDue() {
  return Math.max(0, (this.total || 0) - (this.amountPaid || 0));
});

module.exports = mongoose.models.Order || mongoose.model('Order', OrderSchema);
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
