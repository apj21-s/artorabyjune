const mongoose = require('mongoose');

// A payment screenshot upload this server signed for one order. A proof can only be attached
// if its upload was signed here, for the same order, and hasn't been attached before.
// Unattached uploads are deleted by the daily job after a day.
const ProofUploadSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true },
  provider: { type: String, enum: ['cloudinary', 'local'], required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  attachedTo: { type: mongoose.Schema.Types.ObjectId }, // payment id once used
  deletedAt: Date,
}, { timestamps: true });

module.exports = mongoose.models.ProofUpload || mongoose.model('ProofUpload', ProofUploadSchema);
