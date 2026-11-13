// Daily payment housekeeping (Vercel cron, or the 30-minute timer on a normal server):
//  • finishes approvals that were interrupted (each step is safe to repeat),
//  • deletes screenshot uploads that were never attached to a payment (after a day),
//  • deletes payment screenshots 180 days after the order was settled or cancelled.
// The UTR and June's bank-check notes stay on the payment record.
const config = require('../config');
const { Order, ProofUpload } = require('../models');
const { finishStaleApprovals } = require('../lib/payments');
const cloudinary = require('./cloudinary');
const proofFiles = require('../lib/proof-files');

const DAY = 24 * 60 * 60 * 1000;
const KEEP_PROOFS_DAYS = 180;

async function removeFile(publicId, provider) {
  if (provider === 'cloudinary') {
    if (!config.features.cloudinary) return false;
    return cloudinary.destroyPrivate(publicId).catch(() => false);
  }
  await proofFiles.deleteLocal(publicId);
  return true;
}

async function runPaymentMaintenance({ now = Date.now(), deadline = now + 30_000 } = {}) {
  const finished = await finishStaleApprovals();

  let orphans = 0;
  const unattached = await ProofUpload.find({ attachedTo: { $exists: false }, deletedAt: { $exists: false }, createdAt: { $lte: new Date(now - DAY) } }).limit(100);
  for (const u of unattached) {
    if (Date.now() > deadline) break;
    if (await removeFile(u.publicId, u.provider)) {
      u.deletedAt = new Date();
      await u.save();
      orphans += 1;
    }
  }

  let expired = 0;
  const cutoff = new Date(now - KEEP_PROOFS_DAYS * DAY);
  const orders = await Order.find({
    $or: [{ paymentStatus: { $in: ['paid', 'overpaid', 'refunded'] } }, { status: 'cancelled' }],
    updatedAt: { $lte: cutoff },
    'payments.proofId': { $exists: true, $ne: null },
  }).select('payments').limit(50);
  for (const o of orders) {
    for (const p of o.payments.filter((x) => x.proofId && ['paid', 'rejected'].includes(x.status) && (x.reviewedAt || x.at) <= cutoff)) {
      if (Date.now() > deadline) break;
      if (await removeFile(p.proofId, p.proofProvider)) {
        await Order.updateOne({ _id: o._id, 'payments._id': p._id }, { $unset: { 'payments.$.proofId': 1 }, $set: { 'payments.$.note': [p.note, 'Screenshot deleted after 180 days.'].filter(Boolean).join(' ') } });
        await ProofUpload.updateOne({ publicId: p.proofId }, { $set: { deletedAt: new Date() } });
        expired += 1;
      }
    }
  }
  return { finished, orphans, expired };
}

module.exports = { runPaymentMaintenance, KEEP_PROOFS_DAYS };
