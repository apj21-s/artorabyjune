const mongoose = require('mongoose');

// Reserves a UPI reference number (UTR) for exactly one payment, across every order.
// The unique index is what makes this safe: two customers submitting the same UTR at the
// same moment can't both succeed. Rejecting a payment deletes its reservation, so the
// customer can send the same UTR again with a clearer screenshot. Paid ones stay forever.
const PaymentRefSchema = new mongoose.Schema({
  utr: { type: String, required: true, unique: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });

module.exports = mongoose.models.PaymentRef || mongoose.model('PaymentRef', PaymentRefSchema);
