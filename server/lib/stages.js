// The journey every order travels. Keys are stored; labels are what customers see.
const STAGES = {
  received: {
    label: 'June has received your story',
    note: 'Your note is safely in the studio.',
  },
  quoted: {
    label: 'Your quote and sketch are ready',
    note: 'Take a look, approve it, and pay the deposit to begin painting.',
    commissionOnly: true,
  },
  confirmed: {
    label: 'Payment confirmed',
    note: 'Thank you. June can begin.',
  },
  painting: {
    label: 'June is painting your memory',
    note: 'Brushes are on your canvas.',
    commissionOnly: true,
  },
  packing: {
    label: 'June is packaging your story',
    note: 'Sealed for daily use and wrapped with care.',
  },
  shipped: {
    label: 'Your story is on its way',
    note: 'Handed to the courier.',
  },
  delivered: {
    label: 'Your story has arrived',
    note: 'We hope it feels like home.',
  },
  cancelled: {
    label: 'Order cancelled',
    note: 'This order has been cancelled.',
    terminal: true,
  },
};

const COMMISSION_FLOW = ['received', 'quoted', 'confirmed', 'painting', 'packing', 'shipped', 'delivered'];
const SHOP_FLOW = ['received', 'confirmed', 'packing', 'shipped', 'delivered'];

function flowFor(type) {
  return type === 'commission' ? COMMISSION_FLOW : SHOP_FLOW;
}

function stageLabel(key) {
  return STAGES[key]?.label || key;
}

// Customer-facing timeline: every step in the flow, marked done/current/upcoming.
function buildTimeline(order) {
  const flow = flowFor(order.type);
  const history = new Map((order.history || []).map((h) => [h.status, h]));
  if (order.status === 'cancelled') {
    return [...(order.history || []).map((h) => ({
      key: h.status, label: stageLabel(h.status), note: h.note || STAGES[h.status]?.note || '', at: h.at, state: 'done',
    }))];
  }
  const currentIndex = flow.indexOf(order.status);
  return flow.map((key, index) => {
    const h = history.get(key);
    let state = 'upcoming';
    if (index < currentIndex) state = 'done';
    if (index === currentIndex) state = 'current';
    return {
      key,
      label: STAGES[key].label,
      note: h?.note || STAGES[key].note,
      at: h?.at || null,
      state,
    };
  });
}

module.exports = { STAGES, COMMISSION_FLOW, SHOP_FLOW, flowFor, stageLabel, buildTimeline };
