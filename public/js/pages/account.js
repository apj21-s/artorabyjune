import { $, $$, html, raw, inr, fmtDate, formData } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { initLayout, session, wireAddToCart } from '../core/layout.js';
import { productCard } from '../core/components.js';
import { syncSaved } from '../core/saved.js';
import { toast, toastError, busy, validateForm, handleFormError, openModal } from '../core/ui.js';
import { paymentChip, emptyState } from '../core/components.js';

initLayout();

let addresses = [];

function wireTabs() {
  const tabs = $$('[data-tab]');
  const show = (name) => {
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    $$('[data-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name));
    history.replaceState(null, '', `#${name}`);
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  const initial = location.hash.slice(1);
  if (tabs.some((t) => t.dataset.tab === initial)) show(initial);
}

function orderCard(o) {
  const steps = o.timeline.filter((s) => s.key !== 'cancelled');
  const link = `/order/${encodeURIComponent(o.number)}?t=${encodeURIComponent(o.token)}`;
  const action = o.canApprove ? 'Review sketch & approve'
    : o.pendingPayment ? 'Payment being checked'
      : o.canPayBalance ? `Pay balance ${inr(o.due.amount)}`
        : o.canPayDeposit ? `Pay deposit ${inr(o.due.amount)}`
          : o.canPayShop ? 'Complete payment' : 'View details';
  const title = o.type === 'commission' ? `${o.commission?.tierTitle || 'Commission'}${o.commission?.occasion ? ` · ${o.commission.occasion}` : ''}` : o.items.map((i) => i.title).join(', ');
  // Each order is a kraft parcel tag, strung through a hole on the left.
  return html`
    <article class="parcel-tag">
      <span class="parcel-hole" aria-hidden="true"></span>
      <div class="parcel-body">
        <div class="acct-order-head">
          <div>
            <p class="order-no">${o.number}</p>
            <h3>${title}</h3>
            <div class="meta-row"><span>${fmtDate(o.createdAt)}</span>${raw(paymentChip(o))}${o.total ? raw(html`<span>${inr(o.total)}</span>`) : ''}</div>
          </div>
          <a class="btn ${o.canApprove || o.canPay ? 'btn-primary' : 'btn-ghost'} btn-sm" href="${link}${o.canPay ? '#payment' : ''}">${action}</a>
        </div>
        <div class="parcel-status">
          <strong>${o.statusLabel}</strong>
          <div class="progress-pins" aria-hidden="true">${steps.map((s) => raw(`<i class="${s.state !== 'upcoming' ? 'on' : ''}"></i>`))}</div>
        </div>
      </div>
    </article>`;
}

const savedProducts = new Map();
wireAddToCart((id) => savedProducts.get(id));
async function loadSaved() {
  const wrap = $('[data-saved]');
  try {
    await syncSaved();
    const { items } = await get('/me/saved');
    items.forEach((p) => savedProducts.set(p.id, p));
    wrap.innerHTML = items.length
      ? `<div class="board"><div class="grid product-grid">${items.map(productCard).join('')}</div></div>`
      : emptyState({ title: 'Nothing saved yet.', body: 'Tap the heart on any tote to keep it here for later.', cta: 'Browse the shop', href: '/shop' });
    wrap.querySelectorAll('.reveal').forEach((el) => el.classList.add('show'));
  } catch (error) {
    wrap.innerHTML = `<p class="helper-note">${error.message}</p>`;
  }
}

// Orders placed with this email (on the website as a guest, or added by June from a DM) appear once the
// email is confirmed. Until then, the private order link June sends also adds an order here.
function verifyNote(user) {
  if (user.emailVerified) return '';
  return `<div class="verify-note"><p><strong>Don’t see an order?</strong> Confirm your email and every order placed with <em>${user.email.replace(/[<>&"]/g, '')}</em> will appear here. Or open the order link June sent you while you’re signed in.</p><button class="btn btn-ghost btn-sm" type="button" data-resend-verify>Email me a confirmation link</button></div>`;
}

async function loadOrders(user) {
  const wrap = $('[data-orders]');
  try {
    const { items } = await get('/me/orders');
    wrap.innerHTML = verifyNote(user) + (items.length
      ? `<div class="stack">${items.map(orderCard).join('')}</div>`
      : `${emptyState({ title: 'No stories yet.', body: 'When you commission or buy a tote, it will live here with its timeline.', cta: 'Begin your story', href: '/commission' })}`);
    $('[data-resend-verify]', wrap)?.addEventListener('click', async (e) => {
      try {
        const res = await post('/auth/verify-email/resend');
        e.target.closest('.verify-note').innerHTML = res.sent ? '<p>Sent. Check your inbox (and spam) for a link from Artora by June.</p>' : '<p>Email confirmation isn’t switched on yet. Open the order link June sent you while signed in, and the order will appear here.</p>';
      } catch (error) { toastError(error); }
    });
  } catch (error) {
    wrap.innerHTML = `<p class="helper-note">${error.message}</p>`;
  }
}

function renderMemories(items) {
  $('[data-memories]').innerHTML = items.length ? items.map((m) => html`
    <article class="pinned-note">
      <span class="pin" aria-hidden="true"></span>
      <h3>${m.title}</h3>
      ${m.note ? raw(html`<p>${m.note}</p>`) : ''}
      <span class="helper-note">${fmtDate(m.createdAt)}</span>
      <div class="action-row">
        <a class="btn btn-primary btn-sm" href="/commission?memory=${encodeURIComponent(`${m.title}${m.note ? ` — ${m.note}` : ''}`)}">Paint this</a>
        <button class="btn btn-ghost btn-sm" type="button" data-del-memory="${m._id}">Remove</button>
      </div>
    </article>`).join('') : '';
}

function wireMemories() {
  const form = $('[data-memory-form]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    await busy(form.querySelector('button'), async () => {
      try {
        const { items } = await post('/me/memories', formData(form));
        form.reset();
        renderMemories(items);
        toast('Memory saved to your studio.');
      } catch (error) { handleFormError(form, error); }
    });
  });
  $('[data-memories]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-memory]');
    if (!b) return;
    try {
      const { items } = await del(`/me/memories/${b.dataset.delMemory}`);
      renderMemories(items);
    } catch (error) { toastError(error); }
  });
}

function addressForm(a = {}) {
  return html`<form class="stack" novalidate>
    <div class="field-pair">
      <div class="field"><label for="adLabel">Label</label><input id="adLabel" name="label" value="${a.label || 'Home'}" maxlength="30"></div>
      <div class="field"><label for="adName">Recipient</label><input id="adName" name="name" value="${a.name || ''}" required></div>
    </div>
    <div class="field"><label for="adLine1">Address</label><input id="adLine1" name="line1" value="${a.line1 || ''}" required></div>
    <div class="field"><label for="adLine2">Landmark</label><input id="adLine2" name="line2" value="${a.line2 || ''}"></div>
    <div class="field-trio">
      <div class="field"><label for="adPin">Pincode</label><input id="adPin" name="pincode" value="${a.pincode || ''}" required inputmode="numeric" maxlength="6"></div>
      <div class="field"><label for="adCity">City</label><input id="adCity" name="city" value="${a.city || ''}" required></div>
      <div class="field"><label for="adState">State</label><input id="adState" name="state" value="${a.state || ''}" required></div>
    </div>
    <div class="field"><label for="adPhone">Phone</label><input id="adPhone" name="phone" value="${a.phone || ''}" required type="tel"></div>
    <button class="btn btn-primary" type="submit">Save address</button>
  </form>`;
}

function renderAddresses() {
  $('[data-addresses]').innerHTML = html`
    <div class="memory-grid">
      ${addresses.map((a, i) => raw(html`<div class="envelope-card"><span class="env-stamp" aria-hidden="true"></span><strong>${a.label}</strong><span class="env-line">${a.name}</span><span class="env-line">${a.line1}${a.line2 ? `, ${a.line2}` : ''}</span><span class="env-line">${a.city}, ${a.state} ${a.pincode}</span><span class="env-phone">${a.phone}</span>
        <div class="action-row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" type="button" data-edit-address="${i}">Edit</button><button class="btn btn-link btn-sm" type="button" data-remove-address="${i}">Remove</button></div></div>`))}
      ${addresses.length < 5 ? raw('<button class="envelope-card envelope-new" type="button" data-add-address>+ Add an address</button>') : ''}
    </div>`;
}

async function saveAddresses(next) {
  const { items } = await put('/me/addresses', { items: next });
  addresses = items;
  renderAddresses();
}

function wireAddresses() {
  $('[data-addresses]').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit-address]');
    const add = e.target.closest('[data-add-address]');
    const rm = e.target.closest('[data-remove-address]');
    if (rm) {
      saveAddresses(addresses.filter((_, i) => i !== Number(rm.dataset.removeAddress))).catch(toastError);
      return;
    }
    if (!edit && !add) return;
    const index = edit ? Number(edit.dataset.editAddress) : -1;
    openModal({
      title: index >= 0 ? 'Edit address' : 'New address',
      body: addressForm(addresses[index]),
      onOpen: (body, close) => {
        const form = body.querySelector('form');
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (!validateForm(form)) return;
          const data = formData(form);
          const next = addresses.map((a) => ({ label: a.label, name: a.name, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode }));
          if (index >= 0) next[index] = data; else next.push(data);
          try { await saveAddresses(next); close(); toast('Address saved.'); } catch (error) { handleFormError(form, error); }
        });
      },
    });
  });
}

function wireProfile(user) {
  const form = $('[data-profile]');
  form.name.value = user.name || '';
  form.phone.value = user.phone || '';
  form.pronouns.value = user.profile?.pronouns || '';
  form.bio.value = user.profile?.bio || '';
  $('#pfEmail').value = user.email;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    await busy(form.querySelector('button'), async () => {
      try {
        await put('/me/profile', formData(form));
        toast('Profile saved.');
        $('[data-greeting]').textContent = `Hello, ${form.name.value.split(' ')[0]}.`;
      } catch (error) { handleFormError(form, error); }
    });
  });
}

// Modal markup lives on the admin page; storefront pages get a lightweight copy on demand.
function ensureModal() {
  if ($('[data-modal]')) return;
  document.body.insertAdjacentHTML('beforeend', '<div class="modal-backdrop" data-modal hidden><div class="modal paper" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1"><div class="modal-head"><h2 id="modalTitle" data-modal-title></h2><button class="icon-btn" type="button" data-modal-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="modal-body" data-modal-body></div></div></div>');
}

(async () => {
  const user = await session();
  if (!user) {
    location.replace(`/login?next=${encodeURIComponent('/account')}`);
    return;
  }
  ensureModal();
  $('[data-greeting]').textContent = `Hello, ${(user.name || 'friend').split(' ')[0]}.`;
  $('[data-admin-link]').hidden = user.role !== 'admin';
  $('[data-logout]').addEventListener('click', async () => {
    await post('/auth/logout').catch(() => {});
    location.href = '/';
  });
  wireTabs();
  wireProfile(user);
  wireMemories();
  wireAddresses();
  const verified = new URLSearchParams(location.search).get('verified');
  if (verified === '1') { user.emailVerified = true; toast('Email confirmed. Your orders are all here.'); }
  if (verified === 'expired') toast('That confirmation link has expired. Ask for a new one below.', { type: 'error' });
  if (verified) history.replaceState(null, '', '/account');
  loadOrders(user);
  loadSaved();
  try {
    const profile = await get('/me/profile');
    addresses = profile.addresses || [];
    renderAddresses();
    renderMemories(profile.memories || []);
  } catch (error) { toastError(error); }
})();
