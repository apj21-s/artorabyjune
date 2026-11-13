const { Order } = require('../models');

// Guest orders placed with this email become visible in the account.
// Only once the person has proved they own the email, so nobody can sign up with someone
// else's address and read their orders.
async function claimGuestOrders(user) {
  if (!user.emailVerified) return;
  await Order.updateMany({ email: user.email, userId: { $exists: false } }, { $set: { userId: user._id } });
}

module.exports = { claimGuestOrders };
