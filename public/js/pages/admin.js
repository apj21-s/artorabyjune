import { $, $$, html, raw, inr, fmtDate, debounce } from '../core/dom.js';
import { get, post, put, patch, del } from '../core/api.js';
import { toast, toastError, busy, openModal } from '../core/ui.js';
import { uploadImage } from '../core/upload.js';

const main = $('[data-admin-main]');
let me = null;
let dirty = false;

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ======================================================================
// Schema-driven fields
// ======================================================================
// field: { name, label, type, options, help, wide, placeholder, min }
// types: text, textarea, number, checkbox, select, date, image, images, tags, lines

function get$(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function set$(obj, path, value) {
  const keys = path.split('.');
  let t = obj;
  keys.slice(0, -1).forEach((k) => { t[k] = t[k] ?? {}; t = t[k]; });
  t[keys[keys.length - 1]] = value;
}

let fieldSeq = 0;
function fieldHtml(f, values) {
  const id = `f${++fieldSeq}`;
  const v = get$(values, f.name);
  const wide = f.wide || ['textarea', 'images', 'lines'].includes(f.type) ? ' wide' : '';
  const help = f.help ? raw(html`<small class="helper-note">${f.help}</small>`) : '';
  const label = html`<label for="${id}">${f.label}</label>`;
  switch (f.type) {
    case 'textarea':
      return html`<div class="field${wide}">${raw(label)}<textarea id="${id}" data-f="${f.name}" rows="${f.rows || 4}" placeholder="${f.placeholder || ''}">${v ?? ''}</textarea>${help}</div>`;
    case 'number':
      return html`<div class="field${wide}">${raw(label)}<input id="${id}" data-f="${f.name}" data-type="number" type="number" inputmode="numeric" value="${v ?? ''}" min="${f.min ?? ''}" step="${f.step || 1}">${help}</div>`;
    case 'checkbox':
      return html`<div class="field field-check${wide}"><label class="check"><input id="${id}" data-f="${f.name}" data-type="checkbox" type="checkbox" ${v ? 'checked' : ''}> ${f.label}</label>${help}</div>`;
    case 'select':
      return html`<div class="field${wide}">${raw(label)}<select id="${id}" data-f="${f.name}">${f.options.map(([val, text]) => raw(html`<option value="${val}" ${String(v ?? f.default ?? '') === String(val) ? 'selected' : ''}>${text}</option>`))}</select>${help}</div>`;
    case 'date':
      return html`<div class="field${wide}">${raw(label)}<input id="${id}" data-f="${f.name}" type="date" value="${v ? String(v).slice(0, 10) : ''}">${help}</div>`;
    case 'tags':
      return html`<div class="field${wide}">${raw(label)}<input id="${id}" data-f="${f.name}" data-type="tags" value="${(v || []).join(', ')}" placeholder="${f.placeholder || 'comma, separated'}">${help}</div>`;
    case 'lines':
      return html`<div class="field${wide}">${raw(label)}<textarea id="${id}" data-f="${f.name}" data-type="lines" rows="${f.rows || 4}" placeholder="One per line">${(v || []).join('\n')}</textarea>${help}</div>`;
    case 'image':
      return html`<div class="field${wide}">${raw(label)}
        <div class="image-field" data-image-field="${f.purpose || 'site'}">
          <div class="image-preview">${v ? raw(html`<img src="${v}" alt="">`) : raw('<span>No image</span>')}</div>
          <div class="image-controls">
            <input id="${id}" data-f="${f.name}" value="${v || ''}" placeholder="https://… or upload">
            <label class="btn btn-ghost btn-sm upload-btn">Upload<input type="file" accept="image/*" data-upload hidden></label>
            ${v ? raw('<button type="button" class="btn btn-ghost btn-sm" data-image-clear>Remove</button>') : ''}
          </div>
          ${f.library ? raw('<div class="image-library" data-image-library><span class="helper-note">Loading studio images…</span></div>') : ''}
        </div>${help}</div>`;
    case 'images':
      return html`<div class="field wide">${raw(label)}
        <div class="images-field" data-images-field="${f.purpose || 'products'}" data-f="${f.name}" data-type="images">
          <div class="images-list">${(v || []).map((src) => raw(html`<figure data-src="${src}"><img src="${src}" alt=""><button type="button" class="img-remove" aria-label="Remove image">×</button><button type="button" class="img-left" aria-label="Move left">‹</button></figure>`))}</div>
          <label class="btn btn-ghost btn-sm upload-btn">Add images<input type="file" accept="image/*" multiple data-upload-many hidden></label>
        </div>${help}</div>`;
    default:
      return html`<div class="field${wide}">${raw(label)}<input id="${id}" data-f="${f.name}" value="${v ?? ''}" placeholder="${f.placeholder || ''}">${help}</div>`;
  }
}

function fieldsHtml(fields, values = {}) {
  return `<div class="admin-fields">${fields.map((f) => fieldHtml(f, values)).join('')}</div>`;
}

function readFields(root, base = {}) {
  const out = structuredClone(base);
  $$('[data-f]', root).forEach((el) => {
    if (el.closest('[data-list-item]') && !root.matches('[data-list-item]')) return; // nested list items read separately
    const t = el.dataset.type;
    let value;
    if (t === 'checkbox') value = el.checked;
    else if (t === 'number') value = el.value === '' ? null : Number(el.value);
    else if (t === 'tags') value = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === 'lines') value = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (t === 'images') value = $$('figure', el).map((fig) => fig.dataset.src);
    else value = el.value.trim();
    set$(out, el.dataset.f, value);
  });
  return out;
}

// The studio's own pictures (product photos + artworks), offered as one-click choices.
const STUDIO_ART = ['pet', 'couple', 'sunday', 'skyline', 'nature', 'movie', 'fandom', 'words', 'custom'].map((n) => `/assets/art/${n}.svg`);
let libraryPromise;
function studioImages() {
  libraryPromise = libraryPromise || get('/admin/products').then((r) => (r.items || []).flatMap((p) => p.images || [])).catch(() => []).then((photos) => [...new Set([...photos, ...STUDIO_ART])]);
  return libraryPromise;
}
async function fillImageLibraries(root) {
  const boxes = $$('[data-image-library]', root);
  if (!boxes.length) return;
  const images = await studioImages();
  boxes.forEach((box) => {
    const current = $('[data-f]', box.closest('[data-image-field]')).value;
    box.innerHTML = html`<span class="library-label">Or pick from the studio</span><div class="library-grid">${images.map((src) => raw(html`<button type="button" class="library-pick${src === current ? ' is-picked' : ''}" data-pick="${src}" aria-label="Use this image"><img src="${src}" alt="" loading="lazy"></button>`))}</div>`;
  });
}
function setImageValue(box, url) {
  $('[data-f]', box).value = url;
  $('.image-preview', box).innerHTML = url ? html`<img src="${url}" alt="">` : '<span>No image</span>';
  $$('.library-pick', box).forEach((b) => b.classList.toggle('is-picked', b.dataset.pick === url));
  markDirty();
}

// Image upload widgets inside any container.
function wireImageFields(root) {
  fillImageLibraries(root);
  root.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) setImageValue(pick.closest('[data-image-field]'), pick.dataset.pick);
    const clear = e.target.closest('[data-image-clear]');
    if (clear) { setImageValue(clear.closest('[data-image-field]'), ''); clear.remove(); }
  });
  root.addEventListener('change', async (e) => {
    const single = e.target.closest('[data-upload]');
    const many = e.target.closest('[data-upload-many]');
    if (single) {
      const box = single.closest('[data-image-field]');
      const file = single.files[0];
      if (!file) return;
      const preview = $('.image-preview', box);
      preview.classList.add('is-loading');
      try {
        const url = await uploadImage(file, box.dataset.imageField);
        $('[data-f]', box).value = url;
        preview.innerHTML = html`<img src="${url}" alt="">`;
        markDirty();
      } catch (error) { toastError(error); }
      preview.classList.remove('is-loading');
      single.value = '';
    }
    if (many) {
      const box = many.closest('[data-images-field]');
      const list = $('.images-list', box);
      for (const file of Array.from(many.files)) {
        const ph = document.createElement('figure');
        ph.className = 'is-loading';
        list.appendChild(ph);
        try {
          const url = await uploadImage(file, box.dataset.imagesField);
          ph.className = '';
          ph.dataset.src = url;
          ph.innerHTML = html`<img src="${url}" alt=""><button type="button" class="img-remove" aria-label="Remove image">×</button><button type="button" class="img-left" aria-label="Move left">‹</button>`;
          markDirty();
        } catch (error) { ph.remove(); toastError(error); }
      }
      many.value = '';
    }
  });
  root.addEventListener('input', (e) => {
    const box = e.target.closest('[data-image-field]');
    if (box && e.target.matches('[data-f]')) {
      const v = e.target.value.trim();
      $('.image-preview', box).innerHTML = v ? html`<img src="${v}" alt="">` : '<span>No image</span>';
    }
  });
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('.img-remove');
    if (rm) { rm.closest('figure').remove(); markDirty(); }
    const left = e.target.closest('.img-left');
    if (left) {
      const fig = left.closest('figure');
      if (fig.previousElementSibling) fig.parentNode.insertBefore(fig, fig.previousElementSibling);
      markDirty();
    }
  });
}

function markDirty() {
  dirty = true;
  $$('[data-save-bar]').forEach((b) => b.classList.add('is-dirty'));
}
function markClean() {
  dirty = false;
  $$('[data-save-bar]').forEach((b) => b.classList.remove('is-dirty'));
}

function confirmDialog(message, { confirm = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = openModal({
      title: 'Are you sure?',
      body: html`<p>${message}</p><div class="action-row" style="margin-top:18px"><button class="btn ${danger ? 'btn-cherry' : 'btn-primary'}" type="button" data-yes>${confirm}</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div>`,
      onOpen: (body) => {
        body.querySelector('[data-yes]').addEventListener('click', () => { done = true; close(); resolve(true); });
        body.querySelector('[data-modal-close]').addEventListener('click', () => { if (!done) resolve(false); });
      },
    });
  });
}

const head = (title, sub, actions = '') => html`<header class="admin-head"><div><h1>${title}</h1>${sub ? raw(html`<p>${sub}</p>`) : ''}</div><div class="action-row">${raw(actions)}</div></header>`;

// ======================================================================
// Views
// ======================================================================
const STATUS_LABEL = {
  received: 'New', quoted: 'Quoted', confirmed: 'Paid / confirmed', painting: 'Painting', packing: 'Packing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};
const PAY_LABEL = { unpaid: 'Unpaid', deposit_paid: 'Deposit paid', paid: 'Paid', refunded: 'Refunded' };
const statusPill = (s) => html`<span class="pill pill-${s}">${STATUS_LABEL[s] || s}</span>`;
const payPill = (s) => html`<span class="pill pay-${s}">${PAY_LABEL[s] || s}</span>`;

// ---------------- Overview ----------------
// Plain-language "what needs you today" list, so the next job is always obvious.
function todoPanel(s) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const jobs = [
    s.awaitingQuote && { text: `${n(s.awaitingQuote, 'commission needs', 'commissions need')} your price and sketch`, how: 'Open it, type the price, add a photo of your sketch, press Send quote.', href: '#orders?status=received&type=commission', cta: 'Price them' },
    s.awaitingPayment && { text: `${n(s.awaitingPayment, 'shop order is', 'shop orders are')} waiting for payment`, how: 'If the money reached your UPI, open the order and press Record UPI/cash payment.', href: '#orders?status=received&type=shop', cta: 'Check payments' },
    s.toShip && { text: `${n(s.toShip, 'paid order is', 'paid orders are')} ready to paint, pack or ship`, how: 'Move each one to the next stage. When it leaves, add the courier and tracking number.', href: '#orders?open=1', cta: 'Open orders' },
    s.pendingReviews && { text: `${n(s.pendingReviews, 'review is', 'reviews are')} waiting for your OK`, how: 'Approve the ones you’d like shown on the website.', href: '#reviews', cta: 'See reviews' },
    s.unreadMessages && { text: `${n(s.unreadMessages, 'message', 'messages')} from the contact form`, how: 'Reply by email or phone, then mark it as handled.', href: '#messages', cta: 'Read messages' },
  ].filter(Boolean);
  return html`<section class="paper pad todo-panel"><h2>What needs you today</h2>${jobs.length ? raw(html`<ol class="todo-list">${jobs.map((j) => raw(html`<li><div><strong>${j.text}</strong><small>${j.how}</small></div><a class="btn btn-ghost btn-sm" href="${j.href}">${j.cta} →</a></li>`))}</ol>`) : raw('<p class="helper-note">Nothing waiting on you right now. New orders, reviews and messages will show up here.</p>')}</section>`;
}

async function viewOverview() {
  const s = await get('/admin/stats');
  setBadge('orders', s.awaitingQuote);
  setBadge('reviews', s.pendingReviews);
  setBadge('messages', s.unreadMessages);
  const pending = s.checklist.filter((c) => !c.done).length;
  main.innerHTML = html`
    ${raw(head(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${(me.name || 'June').split(' ')[0]}.`, 'Here’s the studio at a glance.', '<button class="btn btn-primary btn-sm" type="button" data-new-order>+ Add an order from Instagram or WhatsApp</button>'))}
    ${raw(todoPanel(s))}
    <div class="stat-grid">
      <a class="stat" href="#orders?status=received&type=commission"><span>Waiting for your quote</span><strong>${s.awaitingQuote}</strong><em>commissions</em></a>
      <a class="stat" href="#orders?open=1"><span>Open commissions</span><strong>${s.openCommissions}</strong><em>in progress</em></a>
      <a class="stat" href="#orders?status=packing"><span>Ready to pack & ship</span><strong>${s.toShip}</strong><em>paid orders</em></a>
      <div class="stat"><span>Revenue, last 30 days</span><strong>${inr(s.revenue30)}</strong><em>${inr(s.revenueAll)} all time · ${s.orderCount} ${s.orderCount === 1 ? 'order' : 'orders'}</em></div>
    </div>
    <div class="admin-cols">
      <section class="paper pad">
        <div class="panel-title"><h2>Latest orders</h2><a href="#orders">All orders →</a></div>
        ${s.recent.length ? raw(html`<table class="admin-table"><tbody>${s.recent.map((o) => raw(html`
          <tr data-open-order="${o._id}" tabindex="0"><td><strong>${o.number}</strong><small>${o.type}</small></td><td>${o.name}</td><td>${raw(statusPill(o.status))}</td><td class="num">${o.total ? inr(o.total) : '—'}</td></tr>`))}</tbody></table>`) : raw('<p class="helper-note">No orders yet. They’ll appear here the moment someone writes to June.</p>')}
      </section>
      <section class="paper pad">
        <div class="panel-title"><h2>Before launch</h2><span class="pill ${pending ? 'pill-received' : 'pill-delivered'}">${pending ? `${pending} to do` : 'All set'}</span></div>
        <ul class="checklist">${s.checklist.map((c) => raw(html`
          <li class="${c.done ? 'is-done' : ''}">
            ${c.manual ? raw(html`<label class="check"><input type="checkbox" data-launch="${c.key}" ${c.done ? 'checked' : ''}> ${c.label}</label>`) : raw(html`<span class="item"><span class="tick" aria-hidden="true">${c.done ? '✓' : '○'}</span><span>${c.label}${c.done ? '' : raw('<span class="sr-only"> (not done)</span>')}</span></span>`)}
            ${!c.done && c.hint ? raw(html`<small>${c.hint}</small>`) : ''}
          </li>`))}</ul>
      </section>
    </div>
    ${s.lowStock.length ? raw(html`<section class="paper pad" style="margin-top:20px"><div class="panel-title"><h2>Low stock</h2><a href="#products">Products →</a></div>
      <div class="chip-row">${s.lowStock.map((p) => raw(html`<span class="chip">${p.title} · ${p.stock} left</span>`))}</div></section>`) : ''}`;
  main.querySelectorAll('[data-launch]').forEach((cb) => cb.addEventListener('change', async () => {
    try {
      const content = await get('/admin/content');
      await put('/admin/content/launch', { ...content.launch, [cb.dataset.launch]: cb.checked });
      cb.closest('li').classList.toggle('is-done', cb.checked);
    } catch (error) { toastError(error); }
  }));
}

// ---------------- Orders ----------------
async function viewOrders(query) {
  const q = new URLSearchParams(query);
  main.innerHTML = html`
    ${raw(head('Orders & commissions', 'Every story, from first note to doorstep.', '<button class="btn btn-primary btn-sm" type="button" data-new-order>+ New order</button><a class="btn btn-ghost btn-sm" href="/api/admin/orders.csv">Download as spreadsheet</a>'))}
    <div class="admin-toolbar">
      <input type="search" placeholder="Search number, name, email, phone" data-q value="${q.get('q') || ''}" aria-label="Search orders">
      <select data-type aria-label="Type"><option value="">All types</option><option value="commission">Commissions</option><option value="shop">Shop orders</option></select>
      <select data-status aria-label="Status"><option value="">Any status</option>${Object.entries(STATUS_LABEL).map(([k, v]) => raw(html`<option value="${k}">${v}</option>`))}</select>
      <label class="check"><input type="checkbox" data-open> Open only</label>
    </div>
    <div class="paper table-paper"><div data-orders-table><div class="skeleton-block"></div></div></div>`;
  const qInput = $('[data-q]');
  const type = $('[data-type]');
  const status = $('[data-status]');
  const open = $('[data-open]');
  type.value = q.get('type') || '';
  status.value = q.get('status') || '';
  open.checked = q.get('open') === '1';
  let page = 1;
  const load = async () => {
    const params = new URLSearchParams({ page });
    if (qInput.value.trim()) params.set('q', qInput.value.trim());
    if (type.value) params.set('type', type.value);
    if (status.value) params.set('status', status.value);
    if (open.checked) params.set('open', '1');
    const data = await get(`/admin/orders?${params}`);
    if (!$('[data-orders-table]')) return; // left the Orders page meanwhile
    $('[data-orders-table]').innerHTML = data.items.length ? html`
      <table class="admin-table orders-table">
        <thead><tr><th>Order</th><th>Customer</th><th>What</th><th>Status</th><th>Payment</th><th class="num">Total</th></tr></thead>
        <tbody>${data.items.map((o) => raw(html`
          <tr data-open-order="${o._id}" tabindex="0">
            <td><strong>${o.number}</strong><small>${fmtDate(o.createdAt)}</small></td>
            <td>${o.name}<small>${o.email}</small></td>
            <td>${o.type === 'commission' ? raw(html`<span class="pill pill-type">Commission</span> ${o.commission?.tierTitle || ''}${o.commission?.deadline ? raw(html`<small>Needed by ${fmtDate(o.commission.deadline)}</small>`) : ''}`) : (o.items || []).map((i) => `${i.title} ×${i.qty}`).join(', ')}</td>
            <td>${raw(statusPill(o.status))}</td>
            <td>${raw(payPill(o.paymentStatus))}</td>
            <td class="num">${o.total ? inr(o.total) : '—'}${o.amountPaid ? raw(html`<small>paid ${inr(o.amountPaid)}</small>`) : ''}</td>
          </tr>`))}</tbody>
      </table>
      ${data.pages > 1 ? raw(html`<div class="pager"><button class="btn btn-ghost btn-sm" data-page="-1" ${page <= 1 ? 'disabled' : ''}>← Newer</button><span>Page ${data.page} of ${data.pages}</span><button class="btn btn-ghost btn-sm" data-page="1" ${page >= data.pages ? 'disabled' : ''}>Older →</button></div>`) : ''}` : '<div class="empty-state"><h3>No orders match.</h3><p>Try clearing the filters.</p></div>';
  };
  const reload = () => { page = 1; load().catch(toastError); };
  qInput.addEventListener('input', debounce(reload, 300));
  [type, status, open].forEach((el) => el.addEventListener('change', reload));
  // Listen on the table itself (it is replaced when you leave Orders). Matching only the pager
  // buttons matters: <body data-page="admin"> also has a data-page attribute.
  $('[data-orders-table]').addEventListener('click', (e) => {
    const p = e.target.closest('.pager [data-page]');
    if (p) { page += Number(p.dataset.page); load().catch(toastError); }
  });
  await load();
}

// ---------------- New order taken outside the website ----------------
// For orders that come in by Instagram DM, WhatsApp, a call or in person. The customer sees it in
// their account as soon as they sign in with the same email.
const SOURCE_NAME = { instagram: 'Instagram', whatsapp: 'WhatsApp', in_person: 'in person', phone: 'a phone call', other: 'somewhere else' };
async function newOrderForm() {
  const [{ items: products }, content] = await Promise.all([get('/admin/products'), get('/admin/content')]);
  const totes = products.filter((p) => p.status === 'live');
  const tiers = content.tiers || [];
  const productOptions = totes.map((p) => raw(html`<option value="${p._id}" data-price="${p.price}">${p.title} · ${inr(p.price)}${p.kind === 'giftcard' ? '' : ` · ${p.stock} in stock`}</option>`));
  const itemRow = () => html`<div class="mo-item"><select name="productId" aria-label="Tote"><option value="">Choose a tote…</option>${productOptions}</select><input name="qty" type="number" min="1" max="20" value="1" aria-label="How many"><button class="btn btn-ghost btn-sm" type="button" data-remove-item aria-label="Remove">✕</button></div>`;
  openModal({
    title: 'Add an order',
    wide: true,
    body: html`<form class="mo-form stack" data-mo novalidate>
      <p class="helper-note">For orders that came in on Instagram, WhatsApp, a call or in person. It works just like a website order: it gets an order number and shows in your list. After saving, press <strong>Copy customer link</strong> and send it to them in the chat. That link shows them the order, and adds it to their account if they’re signed in.</p>

      <fieldset class="mo-step"><legend><span>1</span> Where did it come from?</legend>
        <div class="mo-choices">${Object.entries({ instagram: 'Instagram', whatsapp: 'WhatsApp', in_person: 'In person', phone: 'Phone call', other: 'Other' }).map(([k, v], i) => raw(html`<label><input type="radio" name="source" value="${k}" ${i === 0 ? 'checked' : ''}><span>${v}</span></label>`))}</div>
        <div class="field"><label for="moHandle">Their Instagram or WhatsApp <small>(optional)</small></label><input id="moHandle" name="handle" placeholder="@their.handle or phone number"></div>
      </fieldset>

      <fieldset class="mo-step"><legend><span>2</span> What did they order?</legend>
        <div class="mo-choices"><label><input type="radio" name="type" value="shop" checked><span>A ready-made tote</span></label><label><input type="radio" name="type" value="commission"><span>A custom painting</span></label></div>
        <div data-for="shop">
          <div data-items>${raw(itemRow())}</div>
          <button class="btn btn-ghost btn-sm" type="button" data-add-item>+ Add another tote</button>
          <div class="field"><label for="moDiscount">Discount you gave them, in ₹ <small>(optional)</small></label><input id="moDiscount" name="discount" type="number" min="0" placeholder="0"></div>
        </div>
        <div data-for="commission" hidden>
          <div class="field"><label for="moTier">Size</label><select id="moTier" name="tier">${tiers.map((t) => raw(html`<option value="${t.key}">${t.title} (from ${inr(t.price)})</option>`))}</select></div>
          <div class="field"><label for="moStory">What should be painted?</label><textarea id="moStory" name="story" rows="3" placeholder="Their dog Bruno on a beach at sunset, with his name underneath"></textarea></div>
          <div class="field"><label for="moPrice">Price you agreed, in ₹ <small>(leave empty if you haven’t agreed one yet)</small></label><input id="moPrice" name="price" type="number" min="0" placeholder="e.g. 1499"></div>
        </div>
      </fieldset>

      <fieldset class="mo-step"><legend><span>3</span> Who is it for?</legend>
        <div class="grid-2">
          <div class="field"><label for="moName">Name</label><input id="moName" name="name" required></div>
          <div class="field"><label for="moPhone">Phone <small>(optional)</small></label><input id="moPhone" name="phone" inputmode="tel"></div>
        </div>
        <div class="field"><label for="moEmail">Email</label><input id="moEmail" name="email" type="email" required placeholder="Ask them for it in the chat"><small class="helper-note">Order updates go to this email. Once they confirm it on the website, the order also appears in their account.</small></div>
        <details class="mo-address"><summary>Add their delivery address now <small>(you can also add it later)</small></summary>
          <div class="field"><label for="moL1">Address</label><input id="moL1" name="address.line1" placeholder="House, street, area"></div>
          <div class="field"><label for="moL2">Landmark <small>(optional)</small></label><input id="moL2" name="address.line2"></div>
          <div class="grid-2"><div class="field"><label for="moCity">City</label><input id="moCity" name="address.city"></div><div class="field"><label for="moState">State</label><input id="moState" name="address.state"></div></div>
          <div class="field"><label for="moPin">PIN code</label><input id="moPin" name="address.pincode" inputmode="numeric" maxlength="6"></div>
        </details>
      </fieldset>

      <fieldset class="mo-step"><legend><span>4</span> Have they paid?</legend>
        <div class="mo-choices"><label><input type="radio" name="paid" value="none" checked><span>Not yet</span></label><label><input type="radio" name="paid" value="deposit"><span>Paid half (deposit)</span></label><label><input type="radio" name="paid" value="full"><span>Paid in full</span></label></div>
        <div class="field" data-paid-amount hidden><label for="moPaid">Amount received, in ₹ <small>(leave empty to use the usual amount)</small></label><input id="moPaid" name="paidAmount" type="number" min="0"><input name="paymentNote" placeholder="How they paid, e.g. GPay to my UPI" aria-label="How they paid" style="margin-top:8px"></div>
      </fieldset>

      <div class="field"><label for="moNotes">Notes only you can see <small>(optional)</small></label><textarea id="moNotes" name="notes" rows="2"></textarea></div>
      <label class="check"><input type="checkbox" name="notify" checked> Email the customer a confirmation</label>
      <div class="action-row"><button class="btn btn-primary" type="submit">Create order</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div>
    </form>`,
    onOpen: (body, close) => {
      const form = $('[data-mo]', body);
      const sync = () => {
        const type = form.type.value;
        $$('[data-for]', form).forEach((el) => { el.hidden = el.dataset.for !== type; });
        $('[data-paid-amount]', form).hidden = form.paid.value === 'none';
      };
      form.addEventListener('change', sync);
      form.addEventListener('click', (e) => {
        if (e.target.closest('[data-add-item]')) $('[data-items]', form).insertAdjacentHTML('beforeend', itemRow());
        const rm = e.target.closest('[data-remove-item]');
        if (rm && $$('.mo-item', form).length > 1) rm.closest('.mo-item').remove();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const num = (k) => (f.get(k) ? Number(f.get(k)) : 0);
        const payload = {
          source: f.get('source'), handle: f.get('handle').trim(), type: f.get('type'),
          name: f.get('name').trim(), email: f.get('email').trim(), phone: f.get('phone').trim(),
          items: $$('.mo-item', form).map((row) => ({ productId: $('select', row).value, qty: Number($('input', row).value) || 1 })).filter((i) => i.productId),
          discount: num('discount'), tier: f.get('tier') || '', story: (f.get('story') || '').trim(), price: num('price'),
          address: { line1: f.get('address.line1').trim(), line2: f.get('address.line2').trim(), city: f.get('address.city').trim(), state: f.get('address.state').trim(), pincode: f.get('address.pincode').trim() },
          paid: f.get('paid'), paidAmount: num('paidAmount'), paymentNote: (f.get('paymentNote') || '').trim(),
          notes: f.get('notes').trim(), notify: form.notify.checked,
        };
        if (!payload.name || !payload.email) { toast('Add the customer’s name and email.', { type: 'error' }); return; }
        if (payload.type === 'shop' && !payload.items.length) { toast('Choose at least one tote.', { type: 'error' }); return; }
        const btn = $('[type="submit"]', form);
        try {
          const res = await busy(btn, () => post('/admin/orders/manual', payload), 'Creating…');
          close();
          toast(`Order ${res.number} created. Now press “Copy customer link” and send it to them in the chat.`, { timeout: 8000 });
          location.hash = `orders/${res.id}`;
        } catch (error) { toastError(error); }
      });
      sync();
    },
  });
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-new-order]')) newOrderForm().catch(toastError);
});

async function openOrder(id) {
  const { order: o, flow } = await get(`/admin/orders/${id}`);
  const c = o.commission;
  const customerLink = `${location.origin}/order/${encodeURIComponent(o.number)}?t=${encodeURIComponent(o.token)}`;
  const body = html`
    <div class="order-detail">
      <div class="order-detail-top">
        <div class="meta-row" style="margin:0">${raw(statusPill(o.status))}${raw(payPill(o.paymentStatus))}<span>${fmtDate(o.createdAt)}</span></div>
        <button class="btn btn-ghost btn-sm" type="button" data-copy="${customerLink}">Copy customer link</button>
      </div>
      <div class="admin-cols">
        <section>
          <h3>Customer</h3>
          ${o.source && o.source !== 'website' ? raw(html`<p class="helper-note">Added by hand · came from ${SOURCE_NAME[o.source] || o.source}${o.sourceHandle ? ` (${o.sourceHandle})` : ''}</p>`) : ''}
          <p><strong>${o.name}</strong><br><a href="mailto:${o.email}">${o.email}</a>${o.phone ? raw(html`<br><a href="tel:${o.phone}">${o.phone}</a> · <a href="https://wa.me/${o.phone.replace(/\D/g, '')}" target="_blank" rel="noopener">WhatsApp</a>`) : ''}</p>
          ${o.shippingAddress?.line1 ? raw(html`<h3>Ship to</h3><p>${o.shippingAddress.name}<br>${o.shippingAddress.line1}${o.shippingAddress.line2 ? raw(html`<br>${o.shippingAddress.line2}`) : ''}<br>${o.shippingAddress.city}, ${o.shippingAddress.state} ${o.shippingAddress.pincode}<br>${o.shippingAddress.phone}</p>`) : ''}
          ${o.gift?.isGift ? raw(html`<h3>Gift</h3><p>${o.gift.note || '(no note)'}${o.gift.wrap ? ' · gift wrap' : ''}</p>`) : ''}
          ${o.type === 'shop' ? raw(html`<h3>Items</h3><ul class="plain">${o.items.map((i) => raw(html`<li>${i.title} × ${i.qty} — ${inr(i.price * i.qty)}</li>`))}</ul>`) : ''}
          ${c ? raw(html`
            <h3>The story</h3>
            <p><strong>${c.tierTitle}</strong> · ${c.style} · ${c.baseColour}${c.occasion ? ` · ${c.occasion}` : ''}${c.moods?.length ? ` · ${c.moods.join(', ')}` : ''}</p>
            <blockquote class="story-quote">${c.story}</blockquote>
            ${c.include ? raw(html`<p><strong>Include:</strong> ${c.include}</p>`) : ''}
            ${c.deadline ? raw(html`<p><strong>Needed by:</strong> ${fmtDate(c.deadline)}</p>`) : ''}
            ${c.references?.length ? raw(html`<div class="ref-strip">${c.references.map((u) => raw(html`<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Reference"></a>`))}</div>`) : ''}
            ${c.changeRequests?.length ? raw(html`<h3>Change requests</h3>${c.changeRequests.map((r) => raw(html`<p class="change-req"><small>${fmtDate(r.at)}</small> ${r.message}</p>`))}`) : ''}`) : ''}
        </section>
        <section class="detail-actions">
          ${c && o.amountPaid === 0 ? raw(html`
            <form class="paper pad stack" data-quote>
              <h3>${c.quotedAt ? 'Update quote & sketch' : 'Send quote & sketch'}</h3>
              ${raw(fieldsHtml([
                { name: 'price', label: 'Total price (₹)', type: 'number', min: 1 },
                { name: 'message', label: 'Note to customer', type: 'textarea', rows: 3, placeholder: 'I’ve sketched your two of you under the Goa sunset…' },
                { name: 'sketchImage', label: 'Sketch image', type: 'image', purpose: 'sketches' },
              ], { price: o.subtotal || '', message: c.quoteMessage, sketchImage: c.sketchImage }))}
              <label class="check"><input type="checkbox" data-quote-notify checked> Email the customer</label>
              <button class="btn btn-primary" type="submit">Send quote</button>
            </form>`) : ''}
          <form class="paper pad stack" data-status-form>
            <h3>Move to stage</h3>
            <div class="field"><label for="stSel">Stage</label><select id="stSel" name="status">${flow.map((s) => raw(html`<option value="${s.key}" ${s.key === o.status ? 'selected' : ''}>${s.label}</option>`))}<option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Order cancelled</option></select></div>
            <div class="field"><label for="stNote">Note for the customer (optional)</label><textarea id="stNote" name="note" rows="2" placeholder="e.g. The sky came out even better than the sketch!"></textarea></div>
            <div class="field-pair">
              <div class="field"><label for="trC">Courier</label><input id="trC" name="courier" value="${o.tracking?.courier || ''}" placeholder="Delhivery"></div>
              <div class="field"><label for="trN">Tracking number</label><input id="trN" name="number" value="${o.tracking?.number || ''}"></div>
            </div>
            <div class="field"><label for="trU">Tracking link</label><input id="trU" name="url" value="${o.tracking?.url || ''}" placeholder="https://"></div>
            <label class="check"><input type="checkbox" name="notify" checked> Email the customer</label>
            ${o.type === 'commission' && o.balanceDue > 0 && o.paymentStatus === 'deposit_paid' ? raw(html`<p class="helper-note warn">Balance of ${inr(o.balanceDue)} not paid yet. Moving to “packaging” emails them a reminder.</p>`) : ''}
            <button class="btn btn-primary" type="submit">Update</button>
          </form>
          <div class="paper pad stack">
            <h3>Money</h3>
            <dl class="totals" style="border:0;padding:0">
              <dt>Total</dt><dd>${o.total ? inr(o.total) : 'Not quoted'}</dd>
              ${o.depositAmount ? raw(html`<dt>Deposit</dt><dd>${inr(o.depositAmount)}</dd>`) : ''}
              <dt>Paid</dt><dd>${inr(o.amountPaid)}</dd>
              <dt>Balance</dt><dd>${inr(o.balanceDue)}</dd>
            </dl>
            ${o.payments.filter((p) => p.status === 'paid').map((p) => raw(html`<p class="helper-note">${fmtDate(p.at)} · ${p.kind} · ${inr(p.amount)} · ${p.method}${p.razorpayPaymentId ? ` · ${p.razorpayPaymentId}` : ''}</p>`))}
            ${o.total && o.balanceDue > 0 ? raw(html`<form class="inline-form" data-manual-pay>
              <select name="kind" aria-label="Payment kind">${(o.type === 'shop' ? ['full'] : ['deposit', 'balance']).map((k) => raw(html`<option value="${k}" ${o.paymentStatus === 'deposit_paid' && k === 'balance' ? 'selected' : ''}>${k}</option>`))}</select>
              <input name="amount" type="number" min="1" value="${o.type === 'commission' && o.paymentStatus === 'unpaid' ? o.depositAmount : o.balanceDue}" aria-label="Amount">
              <button class="btn btn-ghost btn-sm" type="submit">Record UPI/cash payment</button>
            </form>`) : ''}
          </div>
          <form class="paper pad stack" data-notes>
            <h3>Private notes</h3>
            <textarea name="internalNotes" rows="3" placeholder="Only you see this">${o.internalNotes}</textarea>
            <button class="btn btn-ghost btn-sm" type="submit">Save notes</button>
          </form>
        </section>
      </div>
      <h3>History</h3>
      <ul class="plain history">${o.history.slice().reverse().map((h) => raw(html`<li><small>${fmtDate(h.at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small> ${STATUS_LABEL[h.status] || h.status}${h.note ? ` — ${h.note}` : ''}</li>`))}</ul>
    </div>`;

  openModal({
    title: `${o.number} · ${o.type === 'commission' ? 'Commission' : 'Shop order'}`,
    body,
    wide: true,
    onOpen: (root, close) => {
      wireImageFields(root);
      const refresh = async () => { close(); await openOrder(id); routeRefresh(); };
      root.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(e.currentTarget.dataset.copy); toast('Link copied. Paste it into WhatsApp or email.'); } catch { toast(e.currentTarget.dataset.copy); }
      });
      root.querySelector('[data-quote]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = readFields(e.target);
        if (!data.price) { toast('Add a price first.', { type: 'error' }); return; }
        await busy(e.submitter, async () => {
          try {
            const r = await post(`/admin/orders/${id}/quote`, { ...data, notify: root.querySelector('[data-quote-notify]').checked });
            toast(`Quote sent: ${inr(r.total)} (deposit ${inr(r.depositAmount)}).`);
            dirty = false;
            refresh();
          } catch (error) { toastError(error); }
        });
      });
      root.querySelector('[data-status-form]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        await busy(e.submitter, async () => {
          try {
            await patch(`/admin/orders/${id}`, {
              status: f.status.value,
              note: f.note.value.trim(),
              notify: f.notify.checked,
              tracking: { courier: f.courier.value.trim(), number: f.number.value.trim(), url: f.url.value.trim() },
            });
            toast('Order updated.');
            refresh();
          } catch (error) { toastError(error); }
        });
      });
      root.querySelector('[data-manual-pay]')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        if (!(await confirmDialog(`Record ${inr(f.amount.value)} as received? The customer will get a receipt email.`, { confirm: 'Record payment', danger: false }))) return;
        try {
          await post(`/admin/orders/${id}/payments`, { kind: f.kind.value, amount: Number(f.amount.value) });
          toast('Payment recorded.');
          refresh();
        } catch (error) { toastError(error); }
      });
      root.querySelector('[data-notes]').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await patch(`/admin/orders/${id}`, { internalNotes: e.target.internalNotes.value }); toast('Notes saved.'); } catch (error) { toastError(error); }
      });
    },
  });
}

// ---------------- Generic collection (products, coupons, reviews) ----------------
const COLLECTIONS = {
  products: {
    title: 'Products',
    sub: 'Ready-made totes in the shop. Drafts stay hidden until you set them live.',
    endpoint: '/admin/products',
    singular: 'product',
    blank: { status: 'live', stock: 1, images: [], tags: [], details: {} },
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'price', label: 'Price (₹)', type: 'number', min: 0 },
      { name: 'compareAt', label: 'Was price (₹, optional)', type: 'number', min: 0, help: 'Shows a struck-through price.' },
      { name: 'stock', label: 'Stock', type: 'number', min: 0, help: 'Set 0 to show “Sold out”. Raising it emails restock subscribers.' },
      { name: 'status', label: 'Visibility', type: 'select', options: [['live', 'Live in shop'], ['draft', 'Draft (hidden)']] },
      { name: 'badge', label: 'Label', placeholder: 'New, Limited, One of one' },
      { name: 'featured', label: 'Feature on the home page', type: 'checkbox' },
      { name: 'images', label: 'Photos (first is the cover; second shows on hover)', type: 'images', purpose: 'products' },
      { name: 'summary', label: 'One-line summary', wide: true },
      { name: 'description', label: 'The story behind it', type: 'textarea' },
      { name: 'tags', label: 'Tags', type: 'tags', help: 'Used for shop filters and gift guide matching (birthday, couples, pets, farewell, festive).' },
      { name: 'colour', label: 'Colour' },
      { name: 'details.size', label: 'Size' },
      { name: 'details.material', label: 'Material' },
      { name: 'details.care', label: 'Care', type: 'textarea', rows: 2 },
      { name: 'sortOrder', label: 'Sort order', type: 'number', help: 'Lower numbers show first.' },
      { name: 'kind', label: 'Type', type: 'select', options: [['tote', 'Tote / pouch (posted)'], ['giftcard', 'Gift card (emailed code)']], help: 'Gift cards need no address; a code is emailed when paid.' },
      { name: 'bundleWithSlug', label: 'Bundle with (product slug)', placeholder: 'sunflower-pouch', help: 'When both are in the bag, the bundle discount comes off.' },
      { name: 'bundleDiscount', label: 'Bundle discount (₹)', type: 'number', min: 0 },
    ],
    row: (p) => html`<td class="thumb-cell"><img src="${p.images?.[0] || '/assets/totes/sunday-sun.svg'}" alt=""></td><td><strong>${p.title}</strong><small>/shop/${p.slug}</small></td><td class="num">${inr(p.price)}</td><td class="num">${p.stock}</td><td>${p.status === 'live' ? raw('<span class="pill pill-delivered">Live</span>') : raw('<span class="pill pill-cancelled">Draft</span>')}${p.featured ? raw(' <span class="pill pill-type">Featured</span>') : ''}</td>`,
    cols: ['', 'Product', 'Price', 'Stock', 'Status'],
  },
  giftcards: {
    title: 'Gift cards',
    sub: 'Codes bought in the shop appear here. You can also issue store credit by hand (for example, instead of a refund).',
    endpoint: '/admin/giftcards',
    singular: 'gift card',
    blank: { active: true, initialAmount: 500 },
    fields: [
      { name: 'code', label: 'Code', placeholder: 'Leave empty to generate one' },
      { name: 'initialAmount', label: 'Value (₹)', type: 'number', min: 1 },
      { name: 'balance', label: 'Balance left (₹)', type: 'number', min: 0, help: 'Leave as is for a new card; it starts full.' },
      { name: 'recipientEmail', label: 'Recipient email' },
      { name: 'recipientName', label: 'Recipient name' },
      { name: 'expiresAt', label: 'Expires on', type: 'date' },
      { name: 'active', label: 'Active', type: 'checkbox' },
      { name: 'note', label: 'Internal note', wide: true, placeholder: 'e.g. credit for order AJ-0042' },
    ],
    row: (g) => html`<td><strong class="mono">${g.code}</strong><small>${g.orderNumber ? `from ${g.orderNumber}` : g.note || 'issued by hand'}</small></td><td class="num">${inr(g.balance)} <small>of ${inr(g.initialAmount)}</small></td><td>${g.recipientEmail || '—'}</td><td>${g.active && g.balance > 0 ? raw('<span class="pill pill-delivered">Usable</span>') : raw('<span class="pill pill-cancelled">Used / off</span>')}${g.expiresAt ? raw(html`<small>until ${fmtDate(g.expiresAt)}</small>`) : ''}</td>`,
    cols: ['Code', 'Balance', 'For', 'Status'],
    clean: (d) => ({ ...d, expiresAt: d.expiresAt || null, balance: d.balance === '' || d.balance === undefined ? undefined : d.balance }),
  },
  coupons: {
    title: 'Coupons',
    sub: 'Discount codes for launches, referrals and repeat customers.',
    endpoint: '/admin/coupons',
    singular: 'coupon',
    blank: { kind: 'percent', active: true, appliesTo: 'all', minOrder: 0, usageLimit: 0 },
    fields: [
      { name: 'code', label: 'Code', placeholder: 'BEGIN10' },
      { name: 'kind', label: 'Type', type: 'select', options: [['percent', 'Percent off'], ['flat', 'Flat ₹ off']] },
      { name: 'value', label: 'Value', type: 'number', min: 0 },
      { name: 'appliesTo', label: 'Works on', type: 'select', options: [['all', 'Everything'], ['shop', 'Ready-made only'], ['commission', 'Commissions only']] },
      { name: 'minOrder', label: 'Minimum order (₹)', type: 'number', min: 0 },
      { name: 'usageLimit', label: 'Max uses (0 = unlimited)', type: 'number', min: 0 },
      { name: 'expiresAt', label: 'Expires on', type: 'date' },
      { name: 'active', label: 'Active', type: 'checkbox' },
      { name: 'note', label: 'Internal note', wide: true, placeholder: 'e.g. Instagram giveaway, Diwali' },
    ],
    row: (c) => html`<td><strong class="mono">${c.code}</strong><small>${c.note || ''}</small></td><td>${c.kind === 'percent' ? `${c.value}% off` : `${inr(c.value)} off`}</td><td>${c.appliesTo}</td><td class="num">${c.uses}${c.usageLimit ? ` / ${c.usageLimit}` : ''}</td><td>${c.active ? raw('<span class="pill pill-delivered">Active</span>') : raw('<span class="pill pill-cancelled">Off</span>')}${c.expiresAt ? raw(html`<small>until ${fmtDate(c.expiresAt)}</small>`) : ''}</td>`,
    cols: ['Code', 'Discount', 'On', 'Used', 'Status'],
    clean: (d) => ({ ...d, expiresAt: d.expiresAt || null }),
  },
  reviews: {
    title: 'Reviews',
    sub: 'Customer reviews arrive here for approval before they appear on the site.',
    endpoint: '/admin/reviews',
    singular: 'review',
    blank: { rating: 5, approved: true },
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'city', label: 'City' },
      { name: 'rating', label: 'Rating (1–5)', type: 'number', min: 1 },
      { name: 'approved', label: 'Show on the website', type: 'checkbox' },
      { name: 'featured', label: 'Pin to the top', type: 'checkbox' },
      { name: 'text', label: 'Review', type: 'textarea' },
      { name: 'photo', label: 'Photo in the testimonials', type: 'image', purpose: 'reviews', library: true, wide: true, help: 'Upload a photo the customer sent, or pick one of the studio’s totes or paintings. Without one, a painting is shown.' },
    ],
    row: (r) => html`<td><strong>${r.name}</strong><small>${r.city || ''}${r.orderNumber ? ` · ${r.orderNumber}` : ''}</small></td><td class="stars-cell">${'★'.repeat(r.rating)}</td><td class="clip">${r.text}</td><td>${r.approved ? raw('<span class="pill pill-delivered">Live</span>') : raw('<span class="pill pill-received">Needs approval</span>')}</td>`,
    cols: ['From', 'Rating', 'Review', 'Status'],
  },
};

async function viewCollection(key) {
  const cfg = COLLECTIONS[key];
  const { items } = await get(cfg.endpoint);
  main.innerHTML = html`
    ${raw(head(cfg.title, cfg.sub, html`<button class="btn btn-primary btn-sm" type="button" data-new>+ New ${cfg.singular}</button>`))}
    <div class="paper table-paper">
      ${items.length ? raw(html`<table class="admin-table">
        <thead><tr>${cfg.cols.map((c) => raw(html`<th>${c}</th>`))}<th></th></tr></thead>
        <tbody>${items.map((item) => raw(html`<tr data-edit="${item._id}" tabindex="0">${raw(cfg.row(item))}<td class="num"><button class="btn btn-link btn-sm" type="button" data-delete="${item._id}">Delete</button></td></tr>`))}</tbody>
      </table>`) : raw(html`<div class="empty-state"><h3>No ${cfg.title.toLowerCase()} yet.</h3><button class="btn btn-primary" type="button" data-new>Add the first ${cfg.singular}</button></div>`)}
    </div>`;
  // Phones show tables as cards; give each cell its column name.
  $$('.admin-table tbody tr', main).forEach((tr) => [...tr.children].forEach((td, i) => { if (cfg.cols[i]) td.dataset.label = cfg.cols[i]; }));
  const byId = new Map(items.map((i) => [i._id, i]));
  const edit = (item) => {
    const isNew = !item._id;
    openModal({
      title: isNew ? `New ${cfg.singular}` : `Edit ${cfg.singular}`,
      wide: key === 'products',
      body: html`<form class="stack" data-coll-form novalidate>${raw(fieldsHtml(cfg.fields, item))}
        <div class="action-row"><button class="btn btn-primary" type="submit">${isNew ? 'Create' : 'Save changes'}</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div></form>`,
      onOpen: (root, close) => {
        wireImageFields(root);
        const form = root.querySelector('form');
        form.addEventListener('input', markDirty);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          let data = readFields(form, {});
          if (cfg.clean) data = cfg.clean(data);
          Object.keys(data).forEach((k) => { if (data[k] === null && k !== 'expiresAt') delete data[k]; });
          await busy(e.submitter, async () => {
            try {
              if (isNew) await post(cfg.endpoint, data);
              else await put(`${cfg.endpoint}/${item._id}`, data);
              markClean();
              close();
              toast(isNew ? `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} created.` : 'Saved.');
              viewCollection(key);
            } catch (error) { toastError(error); }
          });
        });
      },
    });
  };
  main.onclick = async (e) => {
    if (e.target.closest('[data-new]')) return edit({ ...cfg.blank });
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      e.stopPropagation();
      if (!(await confirmDialog(`Delete this ${cfg.singular}? This can’t be undone.`))) return;
      try { await del(`${cfg.endpoint}/${delBtn.dataset.delete}`); toast('Deleted.'); viewCollection(key); } catch (error) { toastError(error); }
      return;
    }
    const row = e.target.closest('[data-edit]');
    if (row) edit(byId.get(row.dataset.edit));
  };
  main.onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('[data-edit]')) e.target.click(); };
}

// ---------------- Content ----------------
const CONTENT = {
  site: {
    title: 'Home page & settings',
    kind: 'object',
    groups: [
      ['Home page', [
        { name: 'announcement', label: 'Announcement bar (leave empty to hide)', wide: true },
        { name: 'heroEyebrow', label: 'Hero label' },
        { name: 'heroTitle', label: 'Hero headline', wide: true },
        { name: 'heroSubtitle', label: 'Hero paragraph', type: 'textarea', rows: 3 },
        { name: 'trustLine', label: 'Trust line under the buttons', wide: true },
        { name: 'marquee', label: 'Scrolling strip words', type: 'lines' },
        { name: 'meetJuneTitle', label: '“Meet June” heading' },
        { name: 'meetJuneBody', label: '“Meet June” text', type: 'textarea', rows: 3 },
      ]],
      ['Money & delivery', [
        { name: 'depositPercent', label: 'Commission deposit (%)', type: 'number', min: 0 },
        { name: 'shippingFlat', label: 'Shipping fee (₹)', type: 'number', min: 0 },
        { name: 'freeShippingAbove', label: 'Free shipping above (₹, 0 = never)', type: 'number', min: 0 },
        { name: 'giftWrapFee', label: 'Gift wrap fee (₹)', type: 'number', min: 0 },
        { name: 'cartReminders', label: 'Email one reminder when someone leaves a bag at checkout', type: 'checkbox', help: 'Sent 6 hours later, once, with a one-click opt-out. Needs order emails connected.' },
        { name: 'dispatchDays', label: 'Dispatch time (days)', placeholder: '2–3' },
        { name: 'deliveryDays', label: 'Delivery time (days)', placeholder: '3–7' },
        { name: 'upiId', label: 'UPI ID (used when Razorpay isn’t connected)', placeholder: 'june@okhdfc' },
        { name: 'upiName', label: 'UPI display name' },
      ]],
      ['Contact', [
        { name: 'supportEmail', label: 'Support email' },
        { name: 'instagram', label: 'Instagram handle (no @)' },
        { name: 'whatsapp', label: 'WhatsApp number (with country code)', placeholder: '+91…' },
        { name: 'replyTime', label: 'Reply time promise' },
      ]],
    ],
  },
  tiers: {
    title: 'Commission tiers',
    kind: 'list',
    itemTitle: (t) => `${t.title || 'New tier'} · ${inr(t.price)}`,
    blank: { key: '', title: '', price: 0, features: [], featured: false },
    fields: [
      { name: 'title', label: 'Name' },
      { name: 'key', label: 'Short id (no spaces)', help: 'Used in links. Don’t change once orders exist.' },
      { name: 'price', label: 'Starts at (₹)', type: 'number', min: 0 },
      { name: 'tag', label: 'Card label' },
      { name: 'turnaround', label: 'Turnaround text', placeholder: '5 to 7 days' },
      { name: 'days', label: 'Painting days (for date planner)', type: 'number', min: 1 },
      { name: 'featured', label: 'Highlight as most loved', type: 'checkbox' },
      { name: 'features', label: 'What’s included', type: 'lines' },
    ],
  },
  faqs: {
    title: 'FAQs',
    kind: 'list',
    itemTitle: (f) => f.question || 'New question',
    blank: { group: 'Orders', question: '', answer: '' },
    fields: [
      { name: 'group', label: 'Group', type: 'select', options: [['Commissions', 'Commissions'], ['Orders', 'Orders'], ['Payments', 'Payments'], ['Shipping', 'Shipping'], ['Care', 'Care']] },
      { name: 'question', label: 'Question', wide: true },
      { name: 'answer', label: 'Answer', type: 'textarea', rows: 3 },
    ],
  },
  gifting: {
    title: 'Gifting occasions',
    kind: 'list',
    itemTitle: (g) => g.title || 'New occasion',
    blank: { key: '', title: '', blurb: '', colour: 'ochre' },
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'key', label: 'Short id', help: 'Products tagged with this id show under the occasion.' },
      { name: 'colour', label: 'Colour', type: 'select', options: [['ochre', 'Ochre'], ['cherry', 'Cherry'], ['sage', 'Sage'], ['blue', 'Blue']] },
      { name: 'blurb', label: 'Short line', type: 'textarea', rows: 2 },
    ],
  },
  portfolio: {
    title: 'Stories (portfolio)',
    kind: 'list',
    itemTitle: (s) => s.title || 'New story',
    blank: { slug: '', title: '', category: '', memory: '', image: '', art: 'custom' },
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'slug', label: 'Link id', help: 'Shows in the address: /stories/your-id' },
      { name: 'category', label: 'Category' },
      { name: 'image', label: 'Photo of the finished piece', type: 'image', purpose: 'site' },
      { name: 'memory', label: 'The memory (one line)', wide: true },
      { name: 'body', label: 'Longer story (optional)', type: 'textarea', rows: 3 },
      { name: 'featured', label: 'Large card', type: 'checkbox' },
      { name: 'wide', label: 'Wide card', type: 'checkbox' },
      { name: 'art', label: 'Placeholder art (when no photo)', type: 'select', options: ['movie', 'couple', 'pet', 'nature', 'fandom', 'words', 'skyline', 'custom'].map((a) => [a, a]) },
    ],
  },
  about: {
    title: 'About page',
    kind: 'object',
    groups: [['About', [
      { name: 'title', label: 'Headline', wide: true },
      { name: 'intro', label: 'Intro', type: 'textarea', rows: 3 },
      { name: 'paragraphs', label: 'Paragraphs (one per line)', type: 'lines', rows: 6 },
    ]]],
    listField: { name: 'promises', label: 'Promises', itemTitle: (p) => p.title || 'New promise', blank: { title: '', body: '' }, fields: [{ name: 'title', label: 'Title' }, { name: 'body', label: 'Text', type: 'textarea', rows: 2 }] },
  },
};

function listEditor(items, cfg) {
  return html`<div class="list-editor" data-list>
    ${items.map((item, i) => raw(listItem(item, cfg, i)))}
  </div>
  <button class="btn btn-ghost btn-sm" type="button" data-add-item>+ Add</button>`;
}

function listItem(item, cfg, i) {
  return html`<details class="list-item paper" data-list-item ${i < 0 ? 'open' : ''}>
    <summary><span class="drag" aria-hidden="true">⋮⋮</span><span data-item-title>${cfg.itemTitle(item)}</span>
      <span class="list-item-actions"><button type="button" class="btn btn-link btn-sm" data-move="-1" aria-label="Move up">↑</button><button type="button" class="btn btn-link btn-sm" data-move="1" aria-label="Move down">↓</button><button type="button" class="btn btn-link btn-sm" data-remove-item>Remove</button></span></summary>
    ${raw(fieldsHtml(cfg.fields, item))}
  </details>`;
}

function wireList(container, cfg) {
  container.addEventListener('click', (e) => {
    const list = $('[data-list]', container);
    if (e.target.closest('[data-add-item]')) {
      list.insertAdjacentHTML('beforeend', listItem(structuredClone(cfg.blank), cfg, -1));
      markDirty();
    }
    const rm = e.target.closest('[data-remove-item]');
    if (rm) { e.preventDefault(); rm.closest('[data-list-item]').remove(); markDirty(); }
    const mv = e.target.closest('[data-move]');
    if (mv) {
      e.preventDefault();
      const item = mv.closest('[data-list-item]');
      if (mv.dataset.move === '-1' && item.previousElementSibling) list.insertBefore(item, item.previousElementSibling);
      if (mv.dataset.move === '1' && item.nextElementSibling) list.insertBefore(item.nextElementSibling, item);
      markDirty();
    }
  });
}

function readList(container) {
  return $$('[data-list-item]', container).map((el) => readFields(el, {}));
}

async function viewContent(section) {
  const all = await get('/admin/content');
  const keys = Object.keys(CONTENT);
  const key = keys.includes(section) ? section : 'site';
  const cfg = CONTENT[key];
  const data = all[key];
  main.innerHTML = html`
    ${raw(head('Site content', 'Change words, prices and sections without touching code. Changes go live within a few seconds.'))}
    <div class="tabs content-tabs" role="tablist">${keys.map((k) => raw(html`<a class="tab ${k === key ? 'is-active' : ''}" href="#content/${k}" role="tab" aria-selected="${k === key}">${CONTENT[k].title}</a>`))}</div>
    <form class="content-form" data-content-form novalidate>
      ${cfg.kind === 'object'
        ? raw(cfg.groups.map(([title, fields]) => html`<section class="paper pad"><h2>${title}</h2>${raw(fieldsHtml(fields, data))}</section>`).join(''))
        : raw(html`<section class="paper pad">${raw(listEditor(data, cfg))}</section>`)}
      ${cfg.listField ? raw(html`<section class="paper pad" data-sub-list><h2>${cfg.listField.label}</h2>${raw(listEditor(data[cfg.listField.name] || [], cfg.listField))}</section>`) : ''}
      <div class="save-bar" data-save-bar><span>Unsaved changes</span><button class="btn btn-primary" type="submit">Save ${cfg.title.toLowerCase()}</button></div>
    </form>`;
  const form = $('[data-content-form]');
  wireImageFields(form);
  if (cfg.kind === 'list') wireList(form, cfg);
  if (cfg.listField) wireList($('[data-sub-list]'), cfg.listField);
  form.addEventListener('input', (e) => {
    markDirty();
    const item = e.target.closest('[data-list-item]');
    if (item) {
      const c = item.closest('[data-sub-list]') ? cfg.listField : cfg;
      $('[data-item-title]', item).textContent = c.itemTitle(readFields(item, {}));
    }
  });
  form.addEventListener('change', markDirty);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let payload;
    if (cfg.kind === 'list') {
      payload = readList(form);
      if (key === 'tiers' || key === 'gifting' || key === 'portfolio') {
        payload.forEach((item) => {
          const field = key === 'portfolio' ? 'slug' : 'key';
          if (!item[field]) item[field] = (item.title || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        });
      }
    } else {
      // Fields inside list items are skipped here and read by readList below.
      payload = readFields(form, structuredClone(data));
      if (cfg.listField) payload[cfg.listField.name] = readList($('[data-sub-list]'));
    }
    await busy(e.submitter, async () => {
      try {
        await put(`/admin/content/${key}`, payload);
        markClean();
        toast('Saved. The site is updated.');
      } catch (error) { toastError(error); }
    });
  });
}

// ---------------- Messages / subscribers / admins ----------------
const EMAIL_STATE = { sent: 'Emailed', failed: 'Email failed', skipped: 'Not emailed' };
const gmailReply = (m) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.email)}&su=${encodeURIComponent(`Re: ${m.topic || 'your message'} · Artora by June`)}`;

async function viewMessages() {
  const [{ items }, log] = await Promise.all([get('/admin/messages'), get('/admin/emails').catch(() => ({ items: [] }))]);
  setBadge('messages', items.filter((m) => !m.handled).length);
  const failed = log.items.filter((e) => e.status === 'failed');
  main.innerHTML = html`
    ${raw(head('Messages', 'Notes from the contact form. Each one also lands in your email inbox; press Reply there to answer.'))}
    <div class="stack">${items.length ? items.map((m) => raw(html`
      <article class="paper pad message ${m.handled ? 'is-handled' : ''}">
        <div class="panel-title"><div><strong>${m.name}</strong> · <a href="mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.topic || 'your message'}`)}">${m.email}</a>${m.phone ? ` · ${m.phone}` : ''}<small>${fmtDate(m.createdAt)} · ${m.topic}${m.spam ? ' · held as spam' : ''}${m.ownerEmail ? ` · ${EMAIL_STATE[m.ownerEmail] || m.ownerEmail}` : ''}</small></div>
        <label class="check"><input type="checkbox" data-handled="${m._id}" ${m.handled ? 'checked' : ''}> Replied</label></div>
        <p class="message-body">${m.message}</p>
        <p><a href="${gmailReply(m)}" target="_blank" rel="noopener">Reply in Gmail →</a></p>
      </article>`)) : raw('<div class="paper pad empty-state"><h3>Inbox zero.</h3></div>')}</div>
    <section class="paper pad" style="margin-top:28px">
      <div class="panel-title"><div><strong>Email log</strong><small>${log.provider ? `Sending as ${log.sender || log.provider} · alerts go to ${log.inbox}` : 'Email is not connected yet: add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.'}${failed.length ? ` · ${failed.length} failed (retried daily)` : ''}</small></div>
        <button class="btn btn-ghost btn-sm" type="button" data-email-test>Send test email</button></div>
      ${log.items.length ? raw(html`<div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>${log.items.slice(0, 40).map((e) => raw(html`
        <tr><td>${fmtDate(e.createdAt)}</td><td>${e.to}</td><td>${e.subject}</td>
        <td title="${e.lastError || ''}">${e.status}${e.attempts > 1 ? ` ×${e.attempts}` : ''}</td>
        <td>${e.status === 'failed' || e.status === 'queued' ? raw(html`<button class="btn btn-ghost btn-sm" type="button" data-email-retry="${e._id}">Retry</button>`) : ''}</td></tr>`))}</tbody></table></div>`) : raw('<p class="muted">No emails yet.</p>')}
    </section>`;
  main.onchange = async (e) => {
    const cb = e.target.closest('[data-handled]');
    if (!cb) return;
    try { await patch(`/admin/messages/${cb.dataset.handled}`, { handled: cb.checked }); cb.closest('.message').classList.toggle('is-handled', cb.checked); } catch (error) { toastError(error); }
  };
  main.onclick = async (e) => {
    const test = e.target.closest('[data-email-test]');
    const again = e.target.closest('[data-email-retry]');
    if (test) {
      await busy(test, async () => {
        try { const r = await post('/admin/emails/test', {}); toast(`Test email sent to ${r.to}. Check the inbox (and Spam, the first time).`); await viewMessages(); } catch (error) { toastError(error); }
      }, 'Sending…');
    } else if (again) {
      await busy(again, async () => {
        try { await post(`/admin/emails/${again.dataset.emailRetry}/retry`, {}); toast('Sent.'); await viewMessages(); } catch (error) { toastError(error); }
      });
    }
  };
}

async function viewSubscribers() {
  const { items } = await get('/admin/subscribers');
  const news = items.filter((s) => s.kind === 'newsletter');
  const restock = items.filter((s) => s.kind === 'restock');
  main.innerHTML = html`
    ${raw(head('Subscribers', `${news.length} on the newsletter · ${restock.length} waiting for restocks`, '<a class="btn btn-ghost btn-sm" href="/api/admin/subscribers.csv">Export newsletter CSV</a>'))}
    <div class="admin-cols">
      <section class="paper pad"><h2>Newsletter</h2><ul class="plain">${news.map((s) => raw(html`<li>${s.email} <small>${fmtDate(s.createdAt)}</small></li>`))}</ul></section>
      <section class="paper pad"><h2>Restock alerts</h2><ul class="plain">${restock.map((s) => raw(html`<li>${s.email} — ${s.productTitle || ''} <small>${s.notifiedAt ? `notified ${fmtDate(s.notifiedAt)}` : 'waiting'}</small></li>`))}</ul></section>
    </div>`;
}

async function viewAdmins() {
  const { fromEnv, approvedAdminEmails } = await get('/admin/admins');
  main.innerHTML = html`
    ${raw(head('Admin access', 'People with these emails get the admin panel when they sign in.'))}
    <form class="paper pad stack" data-admins style="max-width:640px">
      ${fromEnv.length ? raw(html`<p class="helper-note">Always admins (set in hosting): ${fromEnv.join(', ')}</p>`) : ''}
      <div class="field"><label for="adEmails">Approved admin emails (one per line)</label><textarea id="adEmails" rows="5">${approvedAdminEmails.join('\n')}</textarea></div>
      <button class="btn btn-primary" type="submit">Save access</button>
    </form>`;
  $('[data-admins]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const emails = $('#adEmails').value.split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    try { await put('/admin/admins', { approvedAdminEmails: emails }); toast('Access updated.'); } catch (error) { toastError(error); }
  });
}

// ======================================================================
// Router
// ======================================================================
function setBadge(name, count) {
  $$(`[data-badge="${name}"]`).forEach((b) => {
    b.hidden = !count;
    b.textContent = String(count);
  });
}

// Phones: bottom tab bar + "More" sheet listing every section (no sideways-scrolling menu).
function setMenu(open) {
  document.body.classList.toggle('admin-menu-open', open);
  $('[data-menu-close]').hidden = !open;
  $('[data-menu-toggle]')?.setAttribute('aria-expanded', String(open));
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-menu-toggle]')) { setMenu(!document.body.classList.contains('admin-menu-open')); return; }
  if (e.target.closest('[data-menu-close]') || e.target.closest('.admin-nav a')) setMenu(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('admin-menu-open')) setMenu(false); });

let currentRoute = '';
async function route() {
  if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) {
    history.replaceState(null, '', `#${currentRoute}`);
    return;
  }
  markClean();
  const hash = location.hash.slice(1) || 'overview';
  currentRoute = hash;
  const [pathPart, query = ''] = hash.split('?');
  const [view, arg] = pathPart.split('/');
  $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === view));
  const current = $(`.admin-nav [data-nav="${view}"]`) || $('.admin-nav [data-nav="overview"]');
  $('[data-current-section]').textContent = current ? current.firstChild.textContent.trim() : '';
  const inMore = !['overview', 'orders', 'products', 'messages'].includes(view);
  $('[data-menu-toggle]')?.classList.toggle('is-active', inMore);
  main.onclick = null;
  main.onchange = null;
  main.onkeydown = null;
  main.innerHTML = '<div class="skeleton-block"></div>';
  try {
    if (view === 'orders') {
      await viewOrders(query);
      if (arg) openOrder(arg).catch(toastError);
    } else if (COLLECTIONS[view]) await viewCollection(view);
    else if (view === 'content') await viewContent(arg);
    else if (view === 'messages') await viewMessages();
    else if (view === 'subscribers') await viewSubscribers();
    else if (view === 'admins') await viewAdmins();
    else await viewOverview();
    main.focus({ preventScroll: true });
  } catch (error) {
    main.innerHTML = html`<div class="paper pad empty-state"><h3>That didn’t load.</h3><p>${error.message}</p></div>`;
  }
}
function routeRefresh() {
  const view = (location.hash.slice(1) || 'overview').split(/[/?]/)[0];
  if (view === 'orders' || view === 'overview') route();
}

// Rows anywhere that open an order.
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-open-order]');
  if (row) openOrder(row.dataset.openOrder).catch(toastError);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-open-order]')) e.target.click();
});

(async () => {
  try {
    const { user } = await get('/auth/me');
    if (!user) { location.replace('/login?next=/admin'); return; }
    if (user.role !== 'admin') {
      main.innerHTML = '<div class="paper pad empty-state"><h3>This area is for the studio team.</h3><p>Your account doesn’t have admin access.</p><a class="btn btn-primary" href="/account">Go to your account</a></div>';
      return;
    }
    me = user;
    main.tabIndex = -1;
    $$('[data-logout]').forEach((b) => b.addEventListener('click', async () => { await post('/auth/logout').catch(() => {}); location.href = '/'; }));
    window.addEventListener('hashchange', route);
    route();
  } catch (error) {
    main.innerHTML = html`<div class="paper pad empty-state"><h3>Couldn’t reach the server.</h3><p>${error.message}</p></div>`;
  }
})();

