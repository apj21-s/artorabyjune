// One-off, safe to run any number of times: recomputes every order's money fields
// (amountPaid, paymentStatus) from its payment rows using the current rules in server/lib/money.js.
// Old Razorpay-era rows keep their data; 'created'/'failed' rows simply don't count as money.
//   node server/scripts/migrate-payments.js            (uses MONGODB_URI)
//   node server/scripts/migrate-payments.js --dry-run  (only reports)
const mongoose = require('mongoose');
const config = require('../config');
const { Order } = require('../models');
const money = require('../lib/money');

async function migrate({ dryRun = false } = {}) {
  let checked = 0;
  let changed = 0;
  const cursor = Order.find().select('type status total depositAmount amountPaid paymentStatus payments refunds commission').cursor();
  for await (const order of cursor) {
    checked += 1;
    const before = { amountPaid: order.amountPaid, paymentStatus: order.paymentStatus };
    money.recomputeMoney(order);
    if (order.amountPaid === before.amountPaid && order.paymentStatus === before.paymentStatus) continue;
    changed += 1;
    console.log(`${dryRun ? '[dry run] ' : ''}${order._id}: ${before.paymentStatus}/${before.amountPaid} → ${order.paymentStatus}/${order.amountPaid}`);
    if (!dryRun) {
      // Only if nothing changed meanwhile.
      await Order.updateOne({ _id: order._id, amountPaid: before.amountPaid, paymentStatus: before.paymentStatus }, { $set: { amountPaid: order.amountPaid, paymentStatus: order.paymentStatus } });
    }
  }
  return { checked, changed };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(config.mongoUri);
    const result = await migrate({ dryRun: process.argv.includes('--dry-run') });
    console.log(`Checked ${result.checked} orders, ${result.changed} ${process.argv.includes('--dry-run') ? 'would change' : 'updated'}.`);
    await mongoose.disconnect();
  })().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { migrate };
