// UPI payment workflow: the customer submits proof, June approves or rejects it.
//
// Safety rules this file keeps:
//  • Every state change is one conditional, atomic database update. If the row isn't in the
//    expected state, nothing changes and the caller gets a 409.
//  • A UTR is reserved in PaymentRef (unique index) before the payment is saved, so the same
//    transfer can never be attached to two orders, even by two requests at the same instant.
//  • Approval is "claim, then finish". finishApproval() can run any number of times (after a
//    crash, a timeout, or a double click): stock, coupons and gift cards are keyed per order on
//    their own documents, and emails are keyed in the outbox, so nothing happens twice.
const mongoose = require('mongoose');
const { Order, Product, Coupon, GiftCard, PaymentRef, ProofUpload } = require('../models');
const { pushHistory, giftCardCode } = require('./orders');
const money = require('./money');
const email = require('../services/email');
const { inr } = require('./util');

const MAX_PROOF_SUBMISSIONS = 5;
const ORPHAN_REF_MS = 5 * 60 * 1000;

// Test-only hook: lets tests simulate a crash between claiming and finishing an approval.
const hooks = { afterClaim: null };

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, expose: true, ...extra });

const historyEntry = (order, note) => ({ status: 'payment', note, at: new Date() });
const KIND_LABEL = { full: 'payment', deposit: 'deposit', balance: 'balance' };

// ---------- Side effects (each one safe to repeat) ----------

// Takes the order's items off stock, once per order line, never below zero.
async function commitStockOnce(order) {
  if (order.type !== 'shop') return [];
  const short = [];
  for (const [index, item] of order.items.entries()) {
    if (item.kind === 'giftcard' || !item.productId) continue;
    const key = `order:${order._id}:${index}`;
    const taken = await Product.updateOne(
      { _id: item.productId, stockLedger: { $ne: key }, stock: { $gte: item.qty } },
      { $inc: { stock: -item.qty }, $push: { stockLedger: key } },
    );
    if (taken.modifiedCount) continue;
    // Not taken: either a previous run already did it, or there isn't enough left.
    const marked = await Product.updateOne({ _id: item.productId, stockLedger: { $ne: key } }, { $push: { stockLedger: key } });
    if (marked.modifiedCount) short.push(item);
  }
  return short;
}

async function countCouponOnce(order) {
  if (!order.couponCode) return;
  await Coupon.updateOne(
    { code: order.couponCode, usedByOrders: { $ne: String(order._id) } },
    { $inc: { uses: 1 }, $push: { usedByOrders: String(order._id) } },
  );
}

// Spends the gift card used at checkout, once. Returns false if the balance had run out.
async function redeemGiftCardOnce(order) {
  if (!order.giftCardCode || !order.giftCardAmount) return true;
  const id = String(order._id);
  const res = await GiftCard.updateOne(
    { code: order.giftCardCode, redeemedByOrders: { $ne: id }, balance: { $gte: order.giftCardAmount } },
    { $inc: { balance: -order.giftCardAmount }, $push: { redeemedByOrders: id } },
  );
  if (res.modifiedCount) return true;
  return Boolean(await GiftCard.exists({ code: order.giftCardCode, redeemedByOrders: id }));
}

// Creates the gift cards bought in this order. The (order, index) pair is unique, so a repeat
// finds the card made last time instead of making a new one.
async function issueGiftCardsOnce(order) {
  const lines = order.items.filter((i) => i.kind === 'giftcard');
  const cards = [];
  let index = 0;
  for (const line of lines) {
    for (let n = 0; n < line.qty; n += 1) {
      const source = { sourceOrderId: String(order._id), sourceIndex: index };
      index += 1;
      let card = await GiftCard.findOne(source);
      for (let attempt = 0; !card && attempt < 3; attempt += 1) {
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        try {
          card = await GiftCard.create({
            ...source,
            code: giftCardCode(),
            initialAmount: line.price,
            balance: line.price,
            purchaserEmail: order.email,
            recipientEmail: order.giftCardRecipient?.email || order.email,
            recipientName: order.giftCardRecipient?.name || '',
            message: order.giftCardRecipient?.message || '',
            orderNumber: order.number,
            expiresAt,
          });
        } catch (error) {
          if (error?.code !== 11000) throw error;
          card = await GiftCard.findOne(source); // another run made it; or a code clash, so retry
        }
      }
      if (card) cards.push(card);
    }
  }
  return cards;
}

async function sendGiftCardEmails(order, cards) {
  for (const card of cards) {
    await email.send({ to: card.recipientEmail, ...email.templates.giftCardIssued(card, order), key: `giftcard:${card.code}`, kind: 'giftcard' });
    if (card.recipientEmail !== order.email) {
      await email.send({ to: order.email, ...email.templates.giftCardSent(card, order), key: `giftcard-sent:${card.code}`, kind: 'giftcard' });
    }
  }
}

const appendNote = (existing, note) => (existing && existing.includes(note) ? existing : [existing, note].filter(Boolean).join('\n'));

// ---------- Approval ----------

// Completes an approval that has been claimed (status 'approving'). Safe to call repeatedly.
async function finishApproval(orderId, paymentId) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const order = await Order.findById(orderId);
    if (!order) throw fail(404, 'Order not found.');
    const payment = order.payments.id(paymentId);
    if (!payment) throw fail(404, 'Payment not found.');
    if (!['approving', 'paid'].includes(payment.status)) throw fail(409, 'This payment isn’t being approved. Refresh to see where it stands.');
    const alreadyPaid = payment.status === 'paid';

    // Work out the result in memory first.
    const before = { amountPaid: order.amountPaid, paymentStatus: order.paymentStatus };
    const firstMoney = !order.payments.some((p) => p.status === 'paid' && String(p._id) !== String(paymentId));
    payment.status = 'paid';
    money.recomputeMoney(order);
    const met = money.requiredMet(order);
    const fullyPaid = ['paid', 'overpaid'].includes(order.paymentStatus);

    // Side effects, each keyed so a repeat is a no-op.
    if (firstMoney) await countCouponOnce(order);
    const giftCardOk = firstMoney ? await redeemGiftCardOnce(order) : true;
    // Orders paid before this system (no ledger keys) already had stock and cards handled.
    const short = met && !order.stockCommitted ? await commitStockOnce(order) : [];
    let cards = [];
    if (fullyPaid && !order.giftCardsIssued) cards = await issueGiftCardsOnce(order);
    else if (order.giftCardsIssued) cards = await GiftCard.find({ sourceOrderId: String(order._id) });

    if (!alreadyPaid) {
      const set = {
        'payments.$.status': 'paid',
        'payments.$.reviewedAt': payment.reviewedAt || new Date(),
        'payments.$.at': new Date(),
        amountPaid: order.amountPaid,
        paymentStatus: order.paymentStatus,
      };
      const history = [historyEntry(order, `${inr(payment.amount)} ${KIND_LABEL[payment.kind] || 'payment'} confirmed${payment.reviewedBy ? ` by ${payment.reviewedBy}` : ''}.`)];
      let notes = order.internalNotes || '';
      if (short.length) notes = appendNote(notes, `OVERSOLD: paid but out of stock: ${short.map((i) => `${i.qty} × ${i.title}`).join(', ')}. Contact the customer (repaint, swap or refund).`);
      if (!giftCardOk) notes = appendNote(notes, `GIFT CARD: ${order.giftCardCode} no longer had ${inr(order.giftCardAmount)} when this was paid. Check before shipping.`);
      if (notes !== (order.internalNotes || '')) set.internalNotes = notes;
      if (met) set.stockCommitted = true;
      if (fullyPaid) set.giftCardsIssued = true;
      if (met && ['received', 'quoted'].includes(order.status)) {
        set.status = 'confirmed';
        if (order.type === 'commission' && !order.commission?.approvedAt) set['commission.approvedAt'] = new Date();
        history.push({ status: 'confirmed', note: payment.kind === 'deposit' ? 'Deposit received. June can begin.' : 'Payment received with thanks.', at: new Date() });
      }
      // Only applies if the payment is still 'approving' and no other money moved meanwhile.
      const res = await Order.updateOne(
        { _id: orderId, amountPaid: before.amountPaid, payments: { $elemMatch: { _id: paymentId, status: 'approving' } } },
        { $set: set, $push: { history: { $each: history } } },
      );
      if (!res.modifiedCount) continue; // something changed underneath; reload and try again
    }

    const saved = await Order.findById(orderId);
    const paidRow = saved.payments.id(paymentId);
    await Promise.all([
      email.send({ to: saved.email, ...email.templates.paymentReceived(saved, paidRow), key: `payment:${saved._id}:${paymentId}`, kind: 'payment' }),
      email.notifyAdmin(`${KIND_LABEL[paidRow.kind] || 'payment'} confirmed · ${saved.number}`, [`${inr(paidRow.amount)} from ${saved.name} (${saved.email}).`], `/admin#orders/${saved._id}`, { key: `admin-payment:${saved._id}:${paymentId}`, replyTo: saved.email }),
    ]);
    if (short.length) {
      await email.notifyAdmin(`Action needed: ${saved.number} was paid but is out of stock`, [
        `Someone else bought the last one first: ${short.map((i) => `${i.qty} × ${i.title}`).join(', ')}.`,
        'Reach out to the customer to offer a repaint, a swap or a refund.',
      ], `/admin#orders/${saved._id}`, { key: `admin-short:${saved._id}:${paymentId}`, replyTo: saved.email });
    }
    if (cards.length) await sendGiftCardEmails(saved, cards);
    return { order: saved, payment: paidRow, already: alreadyPaid };
  }
  throw fail(409, 'The order changed while approving. Press “Finish approval” to try again.');
}

function validateReceived(amount, expected) {
  const n = Number(amount);
  const cap = Math.max(1, (expected || 0) * 10, 1_000_000);
  if (!Number.isInteger(n) || n < 1 || n > Math.min(cap, 10_000_000)) throw fail(400, 'Enter the amount your bank shows, in whole rupees.');
  if (expected && n > expected * 10) throw fail(400, 'That amount is more than ten times what was due. Please check it.');
  return n;
}

// June presses Approve: claim the pending payment, then finish it.
async function approvePayment(orderId, paymentId, { amount, bankCheck = {}, admin }) {
  const order = await Order.findById(orderId).select('payments');
  const payment = order?.payments.id(paymentId);
  if (!payment) throw fail(404, 'Payment not found.');
  const received = validateReceived(amount, payment.expectedAmount);
  if (received !== payment.expectedAmount && !bankCheck.amountConfirmed) {
    throw fail(400, `The amount differs from the ${inr(payment.expectedAmount)} that was due. Tick “My bank shows ${inr(received)}” to confirm.`);
  }
  if (!bankCheck.utrMatched) throw fail(400, 'Tick “UTR matches my bank app” once you’ve checked it.');
  const res = await Order.updateOne(
    { _id: orderId, payments: { $elemMatch: { _id: paymentId, status: 'pending' } } },
    {
      $set: {
        'payments.$.status': 'approving',
        'payments.$.amount': received,
        'payments.$.approvalStartedAt': new Date(),
        'payments.$.reviewedBy': admin,
        'payments.$.bankCheck': {
          amount: received,
          date: String(bankCheck.date || '').slice(0, 40),
          sender: String(bankCheck.sender || '').slice(0, 120),
          utrMatched: true,
        },
      },
    },
  );
  if (!res.modifiedCount) throw fail(409, 'This payment was already handled. Refresh to see where it stands.');
  if (hooks.afterClaim) await hooks.afterClaim();
  return finishApproval(orderId, paymentId);
}

// Money June received outside the website flow (cash, a UPI transfer she checked herself).
// Same path as an approval, so all the same guarantees apply.
async function recordManualPayment(orderId, { kind, amount, note, admin, method = 'manual' }) {
  const paymentId = new mongoose.Types.ObjectId();
  const now = new Date();
  const res = await Order.updateOne({ _id: orderId, status: { $ne: 'cancelled' } }, {
    $push: {
      payments: {
        _id: paymentId, kind, amount, expectedAmount: amount, method, status: 'approving',
        note: note || 'Recorded manually', approvalStartedAt: now, submittedAt: now, reviewedBy: admin, at: now,
      },
    },
  });
  if (!res.matchedCount) throw fail(404, 'Order not found, or it was cancelled.');
  if (hooks.afterClaim) await hooks.afterClaim();
  return finishApproval(orderId, paymentId);
}

// Fully covered by a gift card: confirm with a zero payment through the same path.
async function completeWithoutPayment(order) {
  const r = await recordManualPayment(order._id, { kind: 'full', amount: 0, method: 'giftcard', note: `Covered by gift card ${order.giftCardCode}`, admin: 'gift card' });
  return r.order;
}

// ---------- Rejection ----------

async function rejectPayment(orderId, paymentId, { reason, admin, notify = true }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (!why) throw fail(400, 'Choose or type a reason. The customer will see it.');
  const res = await Order.updateOne(
    { _id: orderId, payments: { $elemMatch: { _id: paymentId, status: 'pending' } } },
    {
      $set: { 'payments.$.status': 'rejected', 'payments.$.rejectionReason': why, 'payments.$.reviewedAt': new Date(), 'payments.$.reviewedBy': admin },
      $push: { history: { status: 'payment', note: `Payment proof not accepted: ${why}`, at: new Date() } },
    },
  );
  if (!res.modifiedCount) throw fail(409, 'This payment was already handled. Refresh to see where it stands.');
  // Free the UTR so the customer can send it again with a clearer screenshot.
  await PaymentRef.deleteOne({ paymentId });
  const order = await Order.findById(orderId);
  const payment = order.payments.id(paymentId);
  if (notify) {
    await email.send({ to: order.email, ...email.templates.paymentRejected(order, payment), key: `payment-rejected:${order._id}:${paymentId}`, kind: 'payment' });
  }
  return { order, payment };
}

// When an order is cancelled: any proof still waiting is closed and its UTR released.
async function closeOpenProofs(orderId, admin) {
  const order = await Order.findById(orderId).select('payments');
  const open = (order?.payments || []).filter((p) => p.status === 'pending');
  for (const p of open) {
    await rejectPayment(orderId, p._id, { reason: 'Order cancelled', admin, notify: false }).catch(() => {});
  }
}

// ---------- Refunds ----------

async function recordRefund(orderId, { amount, note, admin }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const order = await Order.findById(orderId);
    if (!order) throw fail(404, 'Order not found.');
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1) throw fail(400, 'Enter the refund in whole rupees.');
    const kept = money.netPaid(order);
    if (n > kept) throw fail(400, `You can refund at most ${inr(kept)}, the amount kept so far.`);
    const before = order.amountPaid;
    const refund = { _id: new mongoose.Types.ObjectId(), amount: n, note: String(note || '').slice(0, 300), by: admin, at: new Date() };
    order.refunds.push(refund);
    money.recomputeMoney(order);
    // Only applies if no other money moved since we read the order.
    const res = await Order.updateOne(
      { _id: orderId, amountPaid: before },
      {
        $push: { refunds: refund, history: { status: 'payment', note: `${inr(n)} refunded${refund.note ? `: ${refund.note}` : ''}.`, at: new Date() } },
        $set: { amountPaid: order.amountPaid, paymentStatus: order.paymentStatus },
      },
    );
    if (res.modifiedCount) {
      const saved = await Order.findById(orderId);
      await email.send({ to: saved.email, ...email.templates.refundRecorded(saved, refund), key: `refund:${saved._id}:${refund._id}`, kind: 'payment' });
      return saved;
    }
  }
  throw fail(409, 'The order changed while recording the refund. Please try again.');
}

// ---------- Customer proof submission ----------

async function reserveUtr(utr, orderId, paymentId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await PaymentRef.create({ utr, orderId, paymentId });
      return;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // A reservation without its payment (a crash between the two steps) is released after a while.
      const ref = await PaymentRef.findOne({ utr });
      const stillUsed = ref && await Order.exists({ _id: ref.orderId, 'payments._id': ref.paymentId });
      if (ref && !stillUsed && Date.now() - ref.createdAt.getTime() > ORPHAN_REF_MS) {
        await PaymentRef.deleteOne({ _id: ref._id, paymentId: ref.paymentId });
        continue;
      }
      throw fail(409, 'This UTR is already linked to a payment. If you think that’s a mistake, message June.');
    }
  }
  throw fail(409, 'This UTR is already linked to a payment. If you think that’s a mistake, message June.');
}

// proof: { provider, publicId, version, signature } (signature checked by the route for Cloudinary)
async function submitProof(order, { kind, utr: rawUtr, publicId, provider }) {
  const utr = money.normalizeUtr(rawUtr);
  if (!money.isValidUtr(utr)) throw fail(400, 'The UTR is the 12-digit number in your UPI app’s payment details.', { field: 'utr' });
  const due = money.amountDue(order);
  if (!due) throw fail(409, 'Nothing is due on this order right now.');
  if (kind !== due.kind) throw fail(409, 'This order has changed since the page loaded. Please refresh and try again.');
  if (money.openPayment(order)) throw fail(409, 'We’re already checking a payment for this order. June will email you soon.');
  if ((order.proofSubmissions || 0) >= MAX_PROOF_SUBMISSIONS) {
    await email.notifyAdmin(`Payment proof limit reached · ${order.number}`, [`${order.name} has sent ${MAX_PROOF_SUBMISSIONS} payment proofs. Please contact them.`], `/admin#orders/${order._id}`, { key: `admin-proof-limit:${order._id}`, replyTo: order.email });
    throw fail(429, 'This order has had several payment attempts. Please message June and she’ll sort it out with you.');
  }

  const paymentId = new mongoose.Types.ObjectId();
  // 1) Claim the screenshot upload for this payment (it must belong to this order, unused).
  const upload = await ProofUpload.findOne({ publicId, provider }).select('orderId attachedTo deletedAt');
  if (!upload || String(upload.orderId) !== String(order._id) || upload.deletedAt) throw fail(400, 'Please upload the screenshot again.', { field: 'screenshot' });
  if (upload.attachedTo) throw fail(409, 'That screenshot was already sent. Please upload it again.', { field: 'screenshot' });
  const claimed = await ProofUpload.updateOne(
    { publicId, orderId: order._id, provider, attachedTo: { $exists: false }, deletedAt: { $exists: false } },
    { $set: { attachedTo: paymentId } },
  );
  if (!claimed.modifiedCount) throw fail(409, 'Please upload the screenshot again.', { field: 'screenshot' });
  const releaseUpload = () => ProofUpload.updateOne({ publicId, attachedTo: paymentId }, { $unset: { attachedTo: 1 } });

  // 2) Reserve the UTR across all orders.
  try {
    await reserveUtr(utr, order._id, paymentId);
  } catch (error) {
    await releaseUpload();
    throw error;
  }

  // 3) Save the payment, only if nothing changed since we read the order.
  const now = new Date();
  const saved = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: { $ne: 'cancelled' },
      amountPaid: order.amountPaid,
      total: order.total,
      proofSubmissions: { $lt: MAX_PROOF_SUBMISSIONS },
      payments: { $not: { $elemMatch: { status: { $in: ['pending', 'approving'] } } } },
    },
    {
      $push: {
        payments: { _id: paymentId, kind, expectedAmount: due.amount, method: 'upi', status: 'pending', utr, proofId: publicId, proofProvider: provider, submittedAt: now, at: now },
        history: { status: 'payment', note: `${inr(due.amount)} ${KIND_LABEL[kind]} sent for checking (UTR ending ${utr.slice(-4)}).`, at: now },
      },
      $inc: { proofSubmissions: 1 },
    },
    { new: true },
  );
  if (!saved) {
    await PaymentRef.deleteOne({ paymentId });
    await releaseUpload();
    throw fail(409, 'We’re already checking a payment for this order, or it changed. Please refresh the page.');
  }

  const payment = saved.payments.id(paymentId);
  await Promise.all([
    email.send({ to: saved.email, ...email.templates.paymentSubmitted(saved, payment), key: `proof:${saved._id}:${paymentId}`, kind: 'payment' }),
    email.notifyAdmin(`Check UPI payment · ${saved.number} · ${inr(due.amount)}`, [
      `${saved.name} says they paid ${inr(due.amount)} (${KIND_LABEL[kind]}).`,
      `UTR: ${utr}. Match it in your bank or UPI app, then approve or reject.`,
    ], `/admin#payments/${saved._id}/${paymentId}`, { key: `admin-proof:${saved._id}:${paymentId}`, replyTo: saved.email }),
  ]);
  return { order: saved, payment };
}

// ---------- Recovery (cron) ----------

async function finishStaleApprovals({ olderThanMs = 10 * 60 * 1000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const orders = await Order.find({ payments: { $elemMatch: { status: 'approving', approvalStartedAt: { $lte: cutoff } } } }).select('payments').limit(50);
  let finished = 0;
  for (const o of orders) {
    for (const p of o.payments.filter((x) => x.status === 'approving' && x.approvalStartedAt <= cutoff)) {
      try { await finishApproval(o._id, p._id); finished += 1; } catch (error) { console.error('[payments] finish stale', o._id, error.message); }
    }
  }
  return finished;
}

module.exports = {
  MAX_PROOF_SUBMISSIONS, hooks, submitProof, approvePayment, finishApproval, rejectPayment, recordManualPayment,
  completeWithoutPayment, recordRefund, closeOpenProofs, finishStaleApprovals, commitStockOnce, issueGiftCardsOnce,
};
