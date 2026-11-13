// Money rules, in one place. Pure functions: they read an order and never touch the database.
//
// Four things are kept apart on purpose:
//   order.status          where the tote is (received → … → delivered). Fulfilment only.
//   order.paymentStatus   what the money adds up to. Written only by recomputeMoney().
//   payments[].status     one payment's review state (pending → approving → paid | rejected).
//   amountDue(order)      what the customer should pay next, worked out here and nowhere else.

const sum = (list, pick) => list.reduce((s, x) => s + (Number(pick(x)) || 0), 0);

function grossPaid(order) {
  return sum((order.payments || []).filter((p) => p.status === 'paid'), (p) => p.amount);
}

function refunded(order) {
  return sum(order.refunds || [], (r) => r.amount);
}

// Money actually kept: every approved payment, minus refunds.
function netPaid(order) {
  return Math.max(0, grossPaid(order) - refunded(order));
}

function hasPaidRow(order) {
  return (order.payments || []).some((p) => p.status === 'paid');
}

// Has enough arrived for June to start? Shop: the full total. Commission: the deposit.
function requiredMet(order) {
  const paid = netPaid(order);
  if (order.type === 'commission') {
    if (!order.total) return false;
    return paid >= (order.depositAmount || order.total);
  }
  return order.total > 0 ? paid >= order.total : hasPaidRow(order);
}

function paymentStatusFor(order) {
  const paid = netPaid(order);
  const total = order.total || 0;
  if (total > 0 && paid > total) return 'overpaid';
  if (total > 0 ? paid === total : (paid === 0 && hasPaidRow(order) && refunded(order) === 0)) return 'paid';
  if (order.type === 'commission' && order.depositAmount && paid >= order.depositAmount) return 'deposit_paid';
  if (paid > 0) return 'partially_paid';
  if (grossPaid(order) > 0 && refunded(order) > 0) return 'refunded';
  return 'unpaid';
}

// Sets amountPaid and paymentStatus from the payment rows. Call after any change to them.
function recomputeMoney(order) {
  order.amountPaid = netPaid(order);
  order.paymentStatus = paymentStatusFor(order);
  return order;
}

function openPayment(order) {
  return (order.payments || []).find((p) => p.status === 'pending' || p.status === 'approving') || null;
}

// What the customer should pay next, or null when nothing is due.
function amountDue(order) {
  if (!order || order.status === 'cancelled') return null;
  const total = order.total || 0;
  if (total <= 0) return null;
  const paid = netPaid(order);
  if (order.type === 'shop') {
    return paid < total ? { kind: 'full', amount: total - paid } : null;
  }
  // Commission: nothing is due until June has quoted and the customer has approved the sketch.
  if (!order.commission?.approvedAt) return null;
  const deposit = order.depositAmount || total;
  if (paid < deposit) return { kind: 'deposit', amount: deposit - paid };
  if (paid < total) return { kind: 'balance', amount: total - paid };
  return null;
}

function overpaidBy(order) {
  return Math.max(0, netPaid(order) - (order.total || 0));
}

// Money June owes back: the excess on an overpaid order, or everything on a cancelled one.
function refundDue(order) {
  if (order.status === 'cancelled') return netPaid(order);
  return overpaidBy(order);
}

const UTR_RE = /^\d{12}$/;
function normalizeUtr(value) {
  return String(value || '').replace(/[\s-]/g, '');
}
function isValidUtr(value) {
  const utr = normalizeUtr(value);
  return UTR_RE.test(utr) && !/^(\d)\1{11}$/.test(utr);
}

module.exports = {
  grossPaid, refunded, netPaid, requiredMet, paymentStatusFor, recomputeMoney, openPayment,
  amountDue, overpaidBy, refundDue, normalizeUtr, isValidUtr,
};
