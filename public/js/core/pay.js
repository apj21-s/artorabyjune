import { post } from './api.js';
import { html, raw, inr } from './dom.js';
import { openModal, toast } from './ui.js';

let razorpayLoader;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  razorpayLoader = razorpayLoader || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Couldn’t load the payment window. Check your connection and try again.'));
    document.head.appendChild(s);
  });
  return razorpayLoader;
}

function manualModal(payment) {
  return new Promise((resolve) => {
    openModal({
      title: 'Pay by UPI',
      body: html`
        <div class="stack">
          <p>${payment.message}</p>
          ${payment.upiId ? raw(html`<div class="upi-box"><span class="muted">UPI ID</span><code>${payment.upiId}</code><span class="muted">Amount: <strong>${inr(payment.amount)}</strong> · Note: <strong>${payment.reference}</strong></span></div>
          <a class="btn btn-primary" href="upi://pay?pa=${encodeURIComponent(payment.upiId)}&pn=${encodeURIComponent(payment.upiName || 'Artora by June')}&am=${payment.amount}&cu=INR&tn=${encodeURIComponent(payment.reference)}">Open UPI app</a>`) : ''}
          <p class="helper-note">Your order is saved. June confirms manual payments by email, usually within a few hours.</p>
          <button class="btn btn-ghost" type="button" data-modal-close>Done</button>
        </div>`,
      onOpen: (_body, close) => {
        _body.querySelector('[data-modal-close]')?.addEventListener('click', () => { close(); resolve({ manual: true }); });
      },
    });
  });
}

// Opens the right payment flow. Resolves { paid: true, order } on success, { manual: true } for UPI fallback.
export async function pay({ payment, number, token }) {
  if (payment.provider === 'none') return { paid: true };
  if (payment.provider === 'manual') return manualModal(payment);
  await loadRazorpay();
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      key: payment.key,
      order_id: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      name: payment.name,
      description: payment.description,
      image: '/assets/icon-192.png',
      prefill: payment.prefill,
      theme: { color: '#221D19' },
      handler: async (response) => {
        try {
          const result = await post('/payments/verify', { number, t: token, ...response });
          resolve({ paid: true, order: result.order });
        } catch (error) {
          reject(error);
        }
      },
      modal: { ondismiss: () => resolve({ dismissed: true }) },
    });
    rz.on('payment.failed', (resp) => {
      toast(resp.error?.description || 'The payment didn’t go through. You can try again.', { type: 'error' });
    });
    rz.open();
  });
}
