const API_BASE = window.ARTORA_API_BASE || '/api';
const DEMO_MODE = window.ARTORA_DEMO_MODE === true;
const STORAGE_KEY = 'artorabyjune.demo.session';

const appState = {
  user: null,
  token: null,
  role: 'guest',
  authMode: 'login',
  afterAuth: null,
  siteContent: null,
  adminData: {
    stories: [],
    faqs: [],
    coupons: [],
    orderStatuses: [],
    orders: [],
  },
  dashboardData: {
    orders: [],
    favorites: [],
    profile: {},
  },
  referenceFiles: [],
};

const els = {
  openAuth: document.getElementById('openAuth'),
  orderForm: document.getElementById('orderForm'),
  orderSubmit: document.getElementById('orderSubmit'),
  sentMsg: document.getElementById('sentMsg'),
  referenceImages: document.getElementById('referenceImages'),
  referencePreview: document.getElementById('referencePreview'),
  loadingScreen: document.getElementById('loadingScreen'),
};

let appReady = false;
let assetsReady = document.readyState === 'complete';
const LOADING_SCREEN_HOLD_MS = 1800;

function buildLoadingText() {
  document.querySelectorAll('[data-loading-text]').forEach((node) => {
    const word = node.querySelector('.loading-word');
    if (!word) return;

    const text = node.dataset.loadingText || '';
    const chars = Array.from(text);
    word.innerHTML = chars.map((char, index) => {
      const display = char === ' ' ? '&nbsp;' : escapeHtml(char);
      const offset = index * 78;
      const exitOffset = (chars.length - index - 1) * 72;
      return `<span class="loading-char${char === ' ' ? ' is-space' : ''}" style="--delay:${offset}ms; --out-delay:${exitOffset}ms;">${display}</span>`;
    }).join('');
  });
}

function maybeFinishLoading() {
  if (!appReady || !assetsReady) return;
  document.documentElement.classList.remove('is-loading');
  document.documentElement.classList.add('is-ready');
  window.setTimeout(() => {
    els.loadingScreen?.remove();
  }, LOADING_SCREEN_HOLD_MS);
}

function apiHeaders(extra = {}) {
  const headers = { ...extra };
  if (appState.token) headers.Authorization = `Bearer ${appState.token}`;
  return headers;
}

async function api(path, options = {}) {
  if (DEMO_MODE) throw new Error('API unavailable');
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: apiHeaders(options.headers || {}),
    ...options,
  });
  if (!res.ok) {
    const message = await res.text().catch(() => '');
    throw new Error(message || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function makeId(prefix = 'row') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function getAdminDefaults(type) {
  const defaults = {
    stories: [
      { title: 'Movie night tote', summary: 'A soft, cinematic memory with a quiet premium finish.', price: '899', image: '', featured: true },
      { title: 'Birthday postcard', summary: 'A brighter story with ribbon-like color and a personal line.', price: '1099', image: '', featured: false },
    ],
    faqs: [
      { question: 'How long does a story take?', answer: 'Most stories are painted in 5 to 10 days.', order: '1' },
      { question: 'Can I save memories first?', answer: 'Yes. Saved memories stay ready for later commissions.', order: '2' },
    ],
    coupons: [
      { code: 'BEGIN10', kind: 'percent', value: '10', expiresAt: '', active: true },
      { code: 'STORY50', kind: 'flat', value: '50', expiresAt: '', active: false },
    ],
    orderStatuses: [
      { label: 'June has received your story', description: 'June has your memory and is preparing the canvas.', etaDays: '0', active: true },
      { label: 'June is sketching your idea', description: 'June is planning the composition.', etaDays: '1', active: true },
      { label: 'June is painting your memory', description: 'June is layering colour by hand.', etaDays: '3', active: true },
      { label: 'June is packaging your story', description: 'Your tote is being wrapped for its journey.', etaDays: '5', active: true },
      { label: 'Your story is on its way', description: 'Your finished tote is travelling to you.', etaDays: '6', active: true },
      { label: 'Your story has arrived', description: 'Your story is home.', etaDays: '7', active: true },
    ],
  };
  return defaults[type] || [];
}

function createAdminItem(type) {
  const id = makeId(type);
  const base = { id };
  if (type === 'stories') return { ...base, title: '', summary: '', price: '', image: '', featured: false };
  if (type === 'faqs') return { ...base, question: '', answer: '', order: '' };
  if (type === 'coupons') return { ...base, code: '', kind: 'percent', value: '', expiresAt: '', active: true };
  if (type === 'orderStatuses') return { ...base, label: '', description: '', etaDays: '', active: true };
  return base;
}

function normalizeAdminItems(type, items = []) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => ({
    ...createAdminItem(type),
    ...item,
    id: item?.id || item?._id || makeId(type),
  }));
}

function adminTableRows(type) {
  return document.querySelector(`[data-crud-table="${type}"] tbody`);
}

function getAdminItemField(row, name) {
  return row.querySelector(`[data-field="${name}"]`);
}

function getAdminTableItems(type) {
  const tbody = adminTableRows(type);
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll('tr')).map((row) => {
    if (type === 'stories') {
      return {
        id: row.dataset.rowId,
        title: getAdminItemField(row, 'title')?.value.trim() || '',
        summary: getAdminItemField(row, 'summary')?.value.trim() || '',
        price: getAdminItemField(row, 'price')?.value.trim() || '',
        image: getAdminItemField(row, 'image')?.value.trim() || '',
        featured: Boolean(getAdminItemField(row, 'featured')?.checked),
      };
    }
    if (type === 'faqs') {
      return {
        id: row.dataset.rowId,
        question: getAdminItemField(row, 'question')?.value.trim() || '',
        answer: getAdminItemField(row, 'answer')?.value.trim() || '',
        order: getAdminItemField(row, 'order')?.value.trim() || '',
      };
    }
    if (type === 'coupons') {
      return {
        id: row.dataset.rowId,
        code: getAdminItemField(row, 'code')?.value.trim() || '',
        kind: getAdminItemField(row, 'kind')?.value || 'percent',
        value: getAdminItemField(row, 'value')?.value.trim() || '',
        expiresAt: getAdminItemField(row, 'expiresAt')?.value || '',
        active: Boolean(getAdminItemField(row, 'active')?.checked),
      };
    }
    if (type === 'orderStatuses') {
      return {
        id: row.dataset.rowId,
        label: getAdminItemField(row, 'label')?.value.trim() || '',
        description: getAdminItemField(row, 'description')?.value.trim() || '',
        etaDays: getAdminItemField(row, 'etaDays')?.value.trim() || '',
        active: Boolean(getAdminItemField(row, 'active')?.checked),
      };
    }
    return { id: row.dataset.rowId };
  });
}

function adminTableMarkup(type, item) {
  const rowId = item.id || makeId(type);
  if (type === 'stories') {
    return `
      <tr data-row-id="${escapeHtml(rowId)}">
        <td><input data-field="title" value="${escapeHtml(item.title || '')}" placeholder="Story title"></td>
        <td><textarea data-field="summary" placeholder="A short story summary">${escapeHtml(item.summary || '')}</textarea></td>
        <td><input data-field="price" value="${escapeHtml(item.price || '')}" placeholder="899"></td>
        <td><input data-field="image" value="${escapeHtml(item.image || '')}" placeholder="https://..."></td>
        <td><label class="toggle-cell"><input data-field="featured" type="checkbox"${item.featured ? ' checked' : ''}><span>Featured</span></label></td>
        <td><button class="crud-icon-btn" type="button" data-remove-row="${type}" data-row-id="${escapeHtml(rowId)}">Delete</button></td>
      </tr>
    `;
  }
  if (type === 'faqs') {
    return `
      <tr data-row-id="${escapeHtml(rowId)}">
        <td><input data-field="question" value="${escapeHtml(item.question || '')}" placeholder="Question"></td>
        <td><textarea data-field="answer" placeholder="Answer">${escapeHtml(item.answer || '')}</textarea></td>
        <td><input data-field="order" value="${escapeHtml(item.order || '')}" placeholder="1"></td>
        <td><button class="crud-icon-btn" type="button" data-remove-row="${type}" data-row-id="${escapeHtml(rowId)}">Delete</button></td>
      </tr>
    `;
  }
  if (type === 'coupons') {
    return `
      <tr data-row-id="${escapeHtml(rowId)}">
        <td><input data-field="code" value="${escapeHtml(item.code || '')}" placeholder="BEGIN10"></td>
        <td>
          <select data-field="kind">
            <option value="percent"${item.kind === 'percent' ? ' selected' : ''}>Percent</option>
            <option value="flat"${item.kind === 'flat' ? ' selected' : ''}>Flat</option>
          </select>
        </td>
        <td><input data-field="value" value="${escapeHtml(item.value || '')}" placeholder="10"></td>
        <td><input data-field="expiresAt" type="date" value="${formatDateInput(item.expiresAt)}"></td>
        <td><label class="toggle-cell"><input data-field="active" type="checkbox"${item.active ? ' checked' : ''}><span>Active</span></label></td>
        <td><button class="crud-icon-btn" type="button" data-remove-row="${type}" data-row-id="${escapeHtml(rowId)}">Delete</button></td>
      </tr>
    `;
  }
  if (type === 'orderStatuses') {
    return `
      <tr data-row-id="${escapeHtml(rowId)}">
        <td><input data-field="label" value="${escapeHtml(item.label || '')}" placeholder="Painting"></td>
        <td><textarea data-field="description" placeholder="A short line for customers">${escapeHtml(item.description || '')}</textarea></td>
        <td><input data-field="etaDays" value="${escapeHtml(item.etaDays || '')}" placeholder="3"></td>
        <td><label class="toggle-cell"><input data-field="active" type="checkbox"${item.active ? ' checked' : ''}><span>Active</span></label></td>
        <td><button class="crud-icon-btn" type="button" data-remove-row="${type}" data-row-id="${escapeHtml(rowId)}">Delete</button></td>
      </tr>
    `;
  }
  return '';
}

function renderCrudTable(type, items = []) {
  const tbody = adminTableRows(type);
  if (!tbody) return;
  const normalized = normalizeAdminItems(type, items);
  appState.adminData[type] = normalized;
  const markup = normalized.length ? normalized.map((item) => adminTableMarkup(type, item)).join('') : adminTableMarkup(type, createAdminItem(type));
  tbody.innerHTML = markup;
}

function renderAdminOrders(items = [], statuses = []) {
  const tbody = adminTableRows('orders');
  if (!tbody) return;
  const statusList = (statuses || []).map((status) => status.label || status).filter(Boolean);
  const fallbackStatuses = ['June has received your story', 'June is sketching your idea', 'June is painting your memory', 'June is packaging your story', 'Your story is on its way', 'Your story has arrived'];
  const options = [...new Set([...statusList, ...fallbackStatuses])];
  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-cell">No orders yet.</td>
      </tr>
    `;
    return;
  }
  tbody.innerHTML = items.map((order) => `
    <tr data-order-id="${escapeHtml(order._id || order.id)}">
      <td>
        <strong>${escapeHtml(order.title || `Story #${order.storyNumber || '-'}`)}</strong>
        <div class="table-subtle">${escapeHtml(order.storyNumber || '')}</div>
      </td>
      <td>
        <strong>${escapeHtml(order.name || order.email || 'Guest')}</strong>
        <div class="table-subtle">${escapeHtml(order.email || order.contact || '')}</div>
      </td>
      <td>
        <select data-order-field="paymentStatus">
          ${['pending', 'paid', 'failed', 'refunded'].map((status) => `<option value="${status}"${String(order.paymentStatus || 'pending') === status ? ' selected' : ''}>${status}</option>`).join('')}
        </select>
      </td>
      <td>
        <select data-order-field="status">
          ${options.map((status) => `<option value="${escapeHtml(status)}"${String(order.status || '') === status ? ' selected' : ''}>${escapeHtml(status)}</option>`).join('')}
        </select>
      </td>
      <td><input data-order-field="shippingUpdate" value="" placeholder="Optional update note"></td>
      <td><button class="crud-icon-btn" type="button" data-save-order="${escapeHtml(order._id || order.id)}">Save</button></td>
    </tr>
  `).join('');
}

function syncSettingsForms(content = {}) {
  const forms = document.querySelectorAll('[data-cms-form]');
  forms.forEach((form) => {
    const key = form.dataset.cmsForm;
    const data = key === 'media'
      ? (content.media || content.siteContent || {})
      : (content[key] || {});
    Array.from(form.elements).forEach((input) => {
      if (input.name && data[input.name] !== undefined) input.value = data[input.name];
    });
  });
}

function hasMeaningfulAdminContent(type, item = {}) {
  if (type === 'stories') return Boolean(item.title || item.summary || item.price || item.image || item.featured);
  if (type === 'faqs') return Boolean(item.question || item.answer || item.order);
  if (type === 'coupons') return Boolean(item.code || item.value || item.expiresAt || item.kind);
  if (type === 'orderStatuses') return Boolean(item.label || item.description || item.etaDays);
  return true;
}

function ensurePortals() {
  if (document.getElementById('authOverlay')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="portal-overlay" id="authOverlay" aria-hidden="true">
      <div class="portal-dialog" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <div class="portal-head">
          <div>
            <span class="eyebrow">Sign in to continue</span>
            <h2 id="authTitle">Keep your story saved.</h2>
            <p>Browse freely. Login is only asked when you are ready to begin an order or open your dashboard.</p>
          </div>
          <button class="portal-close" type="button" data-close-auth aria-label="Close sign in dialog">×</button>
        </div>
        <div class="auth-grid">
          <div class="auth-panel">
            <div class="auth-actions">
              <button class="btn btn-ghost auth-btn is-active" type="button" data-auth-switch="login">Sign in</button>
              <button class="btn btn-ghost auth-btn" type="button" data-auth-switch="signup">Create account</button>
              <button class="btn btn-primary auth-btn" type="button" data-google-signin>Continue with Google</button>
            </div>
            <form class="auth-form" id="authForm">
              <div class="field">
                <label for="authName">Display name</label>
                <input id="authName" name="name" type="text" placeholder="Your name">
              </div>
              <div class="field">
                <label for="authEmail">Email</label>
                <input id="authEmail" name="email" type="email" placeholder="name@example.com" required>
              </div>
              <div class="field">
                <label for="authPassword">Password</label>
                <input id="authPassword" name="password" type="password" placeholder="Minimum 8 characters" required>
              </div>
              <button class="btn btn-primary" type="submit" id="authSubmit">Sign in</button>
              <p class="helper-note" id="authHint">Use email/password now. Google sign-in works when the backend OAuth route is configured.</p>
            </form>
          </div>
          <div class="story-card">
            <h3>What login unlocks</h3>
            <div class="meta-row">
              <span>Saved stories</span>
              <span>Live order timeline</span>
              <span>Profile details</span>
              <span>Admin CMS access for approved roles</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="portal-overlay" id="dashboardOverlay" aria-hidden="true">
      <div class="portal-dialog is-wide" role="dialog" aria-modal="true" aria-labelledby="dashboardTitle">
        <div class="portal-head">
          <div>
            <span class="eyebrow">Your dashboard</span>
            <h2 id="dashboardTitle">Your story studio</h2>
            <p>Orders, saved memories, profile details, and role-based tools live here.</p>
          </div>
          <button class="portal-close" type="button" data-close-dashboard aria-label="Close dashboard">×</button>
        </div>
        <div class="portal-layout">
          <aside class="portal-sidebar">
            <button class="portal-tab is-active" data-portal-tab="orders" type="button">Orders</button>
            <button class="portal-tab" data-portal-tab="favorites" type="button">Saved memories</button>
            <button class="portal-tab" data-portal-tab="profile" type="button">Profile</button>
            <button class="portal-tab admin-tab" data-portal-tab="admin" type="button" hidden>Admin</button>
          </aside>
          <div class="portal-content">
            <section class="portal-section is-active" data-portal-section="orders">
              <div class="timeline" id="customerOrders"></div>
            </section>
            <section class="portal-section" data-portal-section="favorites">
              <div class="story-grid" id="favoriteStories"></div>
            </section>
            <section class="portal-section" data-portal-section="profile">
              <form class="profile-form" id="profileForm">
                <div class="field">
                  <label for="profileName">Display name</label>
                  <input id="profileName" type="text" placeholder="Display name">
                </div>
                <div class="field">
                  <label for="profilePronouns">Pronouns or signature line</label>
                  <input id="profilePronouns" type="text" placeholder="Pronouns or signature line">
                </div>
                <div class="field">
                  <label for="profileBio">Bio</label>
                  <textarea id="profileBio" placeholder="A short line about your stories"></textarea>
                </div>
                <button class="btn btn-primary" type="submit">Save profile</button>
              </form>
            </section>
            <section class="portal-section" data-portal-section="admin">
              <div class="admin-workspace">
                <div class="admin-summary">
                  <div>
                    <span class="eyebrow">Story CMS</span>
                    <h3>Change the site without touching code.</h3>
                    <p>Edit the homepage voice, then manage Stories, FAQs, Coupons, and order stages from polished tables built for non-technical use.</p>
                  </div>
                  <div class="admin-summary-card">
                    <strong>Access control</strong>
                    <p>Approved admin emails are stored in MongoDB and can be expanded later without changing the UI.</p>
                  </div>
                </div>
                <div class="admin-tabs" role="tablist" aria-label="Admin content sections">
                  <button class="portal-tab is-active" data-admin-tab="stories" type="button">Stories</button>
                  <button class="portal-tab" data-admin-tab="faqs" type="button">FAQs</button>
                  <button class="portal-tab" data-admin-tab="coupons" type="button">Coupons</button>
                  <button class="portal-tab" data-admin-tab="orders" type="button">Orders</button>
                  <button class="portal-tab" data-admin-tab="settings" type="button">Settings</button>
                </div>
                <div class="admin-panels">
                  <section class="admin-panel is-active" data-admin-panel="stories">
                    <div class="panel-head">
                      <div>
                        <h3>Stories</h3>
                        <p>Manage product stories, descriptions, prices, images, and featured flags.</p>
                      </div>
                      <div class="auth-actions">
                        <button class="btn btn-ghost auth-btn" type="button" data-add-row="stories">Add story</button>
                        <button class="btn btn-primary auth-btn" type="button" data-save-table="stories">Save stories</button>
                      </div>
                    </div>
                    <div class="table-wrap">
                      <table class="crud-table" data-crud-table="stories">
                        <thead>
                          <tr>
                            <th>Story</th>
                            <th>Summary</th>
                            <th>Price</th>
                            <th>Image URL</th>
                            <th>Featured</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody></tbody>
                      </table>
                    </div>
                  </section>

                  <section class="admin-panel" data-admin-panel="faqs">
                    <div class="panel-head">
                      <div>
                        <h3>FAQs</h3>
                        <p>Keep answers current with a quick table editor.</p>
                      </div>
                      <div class="auth-actions">
                        <button class="btn btn-ghost auth-btn" type="button" data-add-row="faqs">Add FAQ</button>
                        <button class="btn btn-primary auth-btn" type="button" data-save-table="faqs">Save FAQs</button>
                      </div>
                    </div>
                    <div class="table-wrap">
                      <table class="crud-table" data-crud-table="faqs">
                        <thead>
                          <tr>
                            <th>Question</th>
                            <th>Answer</th>
                            <th>Order</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody></tbody>
                      </table>
                    </div>
                  </section>

                  <section class="admin-panel" data-admin-panel="coupons">
                    <div class="panel-head">
                      <div>
                        <h3>Coupons</h3>
                        <p>Manage discounts and promotional codes in one place.</p>
                      </div>
                      <div class="auth-actions">
                        <button class="btn btn-ghost auth-btn" type="button" data-add-row="coupons">Add coupon</button>
                        <button class="btn btn-primary auth-btn" type="button" data-save-table="coupons">Save coupons</button>
                      </div>
                    </div>
                    <div class="table-wrap">
                      <table class="crud-table" data-crud-table="coupons">
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Type</th>
                            <th>Value</th>
                            <th>Expires</th>
                            <th>Active</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody></tbody>
                      </table>
                    </div>
                  </section>

                  <section class="admin-panel" data-admin-panel="orders">
                    <div class="panel-head">
                      <div>
                        <h3>Orders</h3>
                        <p>Update payment and production status, shipping notes, and customer timelines.</p>
                      </div>
                      <button class="btn btn-primary auth-btn" type="button" data-refresh-orders>Refresh orders</button>
                    </div>
                    <div class="table-wrap">
                      <table class="crud-table compact" data-crud-table="orders">
                        <thead>
                          <tr>
                            <th>Story</th>
                            <th>Customer</th>
                            <th>Payment</th>
                            <th>Status</th>
                            <th>Timeline note</th>
                            <th>Save</th>
                          </tr>
                        </thead>
                        <tbody></tbody>
                      </table>
                    </div>
                    <div class="panel-head panel-head-sub">
                      <div>
                        <h3>Order statuses</h3>
                        <p>Keep the public status labels and dashboard timeline steps aligned.</p>
                      </div>
                      <div class="auth-actions">
                        <button class="btn btn-ghost auth-btn" type="button" data-add-row="orderStatuses">Add status</button>
                        <button class="btn btn-primary auth-btn" type="button" data-save-table="orderStatuses">Save statuses</button>
                      </div>
                    </div>
                    <div class="table-wrap">
                      <table class="crud-table" data-crud-table="orderStatuses">
                        <thead>
                          <tr>
                            <th>Status</th>
                            <th>Description</th>
                            <th>ETA days</th>
                            <th>Active</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody></tbody>
                      </table>
                    </div>
                  </section>

                  <section class="admin-panel" data-admin-panel="settings">
                    <div class="panel-head">
                      <div>
                        <h3>Settings</h3>
                        <p>Homepage copy, featured product text, shipping timelines, testimonials, and admin email access.</p>
                      </div>
                      <button class="btn btn-primary auth-btn" type="button" data-save-settings>Save settings</button>
                    </div>
                    <div class="admin-settings-grid">
                      <form class="cms-card" data-cms-form="siteContent">
                        <h3>Homepage wording</h3>
                        <div class="field"><label>Hero title</label><input name="heroTitle" placeholder="Hero title"></div>
                        <div class="field"><label>Hero subtitle</label><textarea name="heroSubtitle" placeholder="Hero subtitle"></textarea></div>
                        <div class="field"><label>Homepage wording</label><textarea name="homepageWording" placeholder="Homepage wording"></textarea></div>
                        <div class="field"><label>Featured products</label><textarea name="featuredProducts" placeholder="Homepage featured products"></textarea></div>
                      </form>
                      <form class="cms-card" data-cms-form="media">
                        <h3>Media URLs</h3>
                        <div class="field"><label>Hero image URL</label><input name="heroImage" placeholder="https://..."></div>
                        <div class="field"><label>Gallery image URL</label><input name="galleryImage" placeholder="https://..."></div>
                        <div class="field"><label>Canvas artwork URL</label><input name="canvasArtwork" placeholder="https://..."></div>
                        <div class="field">
                          <label>Upload file to Cloudinary</label>
                          <input type="file" data-cloudinary-file accept="image/*">
                        </div>
                        <button class="btn btn-ghost" type="button" data-cloudinary-upload>Upload selected image</button>
                      </form>
                    </div>
                  </section>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  `);
}

function showOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
}

function hideOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
}

function showAuth(mode = 'login', afterAuth = null) {
  appState.authMode = mode;
  appState.afterAuth = afterAuth;
  const authOverlay = document.getElementById('authOverlay');
  const authSubmit = document.getElementById('authSubmit');
  const authHint = document.getElementById('authHint');
  const authName = document.getElementById('authName');
  const switchButtons = document.querySelectorAll('[data-auth-switch]');
  switchButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.authSwitch === mode));
  if (authSubmit) authSubmit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  if (authName) authName.parentElement.style.display = mode === 'signup' ? 'grid' : 'none';
  if (authHint) {
    authHint.textContent = mode === 'signup'
      ? 'Create your account first, then your story dashboard and order history will follow.'
      : 'Use email/password now. Google sign-in works when the backend OAuth route is configured.';
  }
  showOverlay('authOverlay');
  if (authOverlay) authOverlay.querySelector('#authEmail')?.focus();
}

function showDashboard() {
  showOverlay('dashboardOverlay');
}

function closeAuth() {
  hideOverlay('authOverlay');
}

function closeDashboard() {
  hideOverlay('dashboardOverlay');
}

function updateAccountButton() {
  if (!els.openAuth) return;
  if (appState.user) {
    els.openAuth.textContent = 'My Story';
    els.openAuth.onclick = () => showDashboard();
  } else {
    els.openAuth.textContent = 'Sign in';
    els.openAuth.onclick = () => showAuth('login');
  }
}

async function loadSession() {
  if (DEMO_MODE) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const session = JSON.parse(raw);
      appState.user = session.user || null;
      appState.token = session.token || null;
      appState.role = session.role || 'customer';
    }
    updateAccountButton();
    if (appState.user) await loadDashboardData();
    return;
  }

  try {
    const session = await api('/api/auth/me');
    appState.user = session.user;
    appState.token = session.token || null;
    appState.role = session.role || 'customer';
    updateAccountButton();
    await loadDashboardData();
  } catch {
    updateAccountButton();
  }
}

function saveDemoSession(user) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    user,
    token: 'demo-token',
    role: user.role || 'customer',
  }));
}

function setUser(user, token = null, role = 'customer') {
  appState.user = user;
  appState.token = token;
  appState.role = role;
  updateAccountButton();
}

function renderOrders(orders = []) {
  const container = document.getElementById('customerOrders');
  if (!container) return;
  if (!orders.length) {
    container.innerHTML = `
      <div class="story-card">
        <h3>No stories yet</h3>
        <p>Your first order will appear here once you begin your story.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = orders.map((order) => {
    const activeIndex = Math.max(0, (order.timeline || []).findIndex((step) => step.active));
    const timeline = (order.timeline || []).map((step, index) => `
      <div class="timeline-step ${step.active ? 'is-active' : ''}">
        <div class="dot"></div>
        <div>
          <strong>${step.label}</strong>
          <p>${step.note || ''}</p>
        </div>
      </div>
    `).join('');
    return `
      <article class="order-card">
        <h3>${order.title || `Story #${order.storyNumber || order._id}`}</h3>
        <div class="meta-row">
          <span>${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'Recently'}</span>
          <span class="status-chip">${order.status || 'Draft'}</span>
          ${order.expectedDelivery ? `<span>Expected: ${new Date(order.expectedDelivery).toLocaleDateString()}</span>` : ''}
        </div>
        <div class="timeline" style="margin-top:14px;">
          ${timeline}
        </div>
      </article>
    `;
  }).join('');
}

function renderFavorites(favorites = []) {
  const container = document.getElementById('favoriteStories');
  if (!container) return;
  if (!favorites.length) {
    container.innerHTML = `
      <div class="story-card">
        <h3>No saved memories yet</h3>
        <p>Save memories before checkout so any of them can become a future tote.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = favorites.map((item) => `
    <article class="story-card">
      <h3>${item.title || 'Untitled memory'}</h3>
      <p>${item.subtitle || item.description || ''}</p>
      <div class="meta-row">
        ${item.tag ? `<span>${item.tag}</span>` : ''}
        ${item.createdAt ? `<span>${new Date(item.createdAt).toLocaleDateString()}</span>` : ''}
      </div>
    </article>
  `).join('');
}

function populateProfile(profile = {}) {
  const name = document.getElementById('profileName');
  const pronouns = document.getElementById('profilePronouns');
  const bio = document.getElementById('profileBio');
  if (name) name.value = profile.displayName || appState.user?.name || '';
  if (pronouns) pronouns.value = profile.pronouns || '';
  if (bio) bio.value = profile.bio || '';
}

function populateAdminState(content = {}) {
  syncSettingsForms(content);
  renderCrudTable('stories', content.stories || getAdminDefaults('stories'));
  renderCrudTable('faqs', content.faqs || getAdminDefaults('faqs'));
  renderCrudTable('coupons', content.coupons || getAdminDefaults('coupons'));
  renderCrudTable('orderStatuses', content.orderStatuses || getAdminDefaults('orderStatuses'));
}

async function loadDashboardData() {
  if (!appState.user) return;

  if (DEMO_MODE) {
    renderOrders([
      {
        storyNumber: '001',
        title: 'The Last Trip Together',
        status: 'June is painting your memory',
        createdAt: Date.now() - 86400000 * 2,
        expectedDelivery: Date.now() + 86400000 * 7,
        timeline: [
          { label: 'June has received your story', note: 'June has your story and is preparing the canvas.', active: true },
          { label: 'June is sketching your idea', note: 'Your composition is being refined.' },
          { label: 'June is painting your memory', note: 'June is layering colour by hand.', active: true },
          { label: 'June is packaging your story', note: 'Your tote is being wrapped with care.' },
          { label: 'Your story has arrived', note: 'Your finished tote is on its way home.' },
        ],
      },
    ]);
    renderFavorites([
      { title: 'Beach trip', subtitle: 'Soft sunset, salt air, old camera roll.' },
      { title: 'Birthday dinner', subtitle: 'Candlelight and a memory worth keeping.' },
    ]);
    populateProfile({ displayName: appState.user.name || 'Artist in Residence', pronouns: 'She / her', bio: 'A quiet collector of moments.' });
    populateAdminState({
      stories: getAdminDefaults('stories'),
      faqs: getAdminDefaults('faqs'),
      coupons: getAdminDefaults('coupons'),
      orderStatuses: getAdminDefaults('orderStatuses'),
      siteContent: {
        heroTitle: 'Some moments deserve more than a photograph.',
        heroSubtitle: 'Choose a memory, and June turns it into a one-of-one canvas story.',
        homepageWording: 'Every tote carries a story.',
      },
    });
    renderAdminOrders([
      {
        _id: 'demo-order-1',
        storyNumber: '001',
        title: 'The Last Trip Together',
        name: 'Arkaprava',
        email: appState.user.email,
        paymentStatus: 'paid',
        status: 'June is painting your memory',
      },
    ], getAdminDefaults('orderStatuses'));
    return;
  }

  try {
    const [orders, favorites, profile, content, adminOrders] = await Promise.all([
      api('/api/me/orders'),
      api('/api/me/favorites'),
      api('/api/me/profile'),
      appState.role === 'admin' ? api('/api/admin/content') : Promise.resolve(null),
      appState.role === 'admin' ? api('/api/admin/orders') : Promise.resolve(null),
    ]);

    appState.dashboardData = {
      orders: orders?.items || [],
      favorites: favorites?.items || [],
      profile: profile?.profile || {},
    };

    renderOrders(appState.dashboardData.orders);
    renderFavorites(appState.dashboardData.favorites);
    populateProfile(appState.dashboardData.profile);
    if (content) {
      populateAdminState(content);
      renderAdminOrders(adminOrders?.items || [], content.orderStatuses || getAdminDefaults('orderStatuses'));
    }
    const adminTab = document.querySelector('.admin-tab');
    if (adminTab) adminTab.hidden = appState.role !== 'admin';
    if (appState.role === 'admin') {
      document.querySelectorAll('[data-portal-tab]').forEach((tab) => {
        tab.classList.toggle('is-active', tab.dataset.portalTab === 'admin');
      });
      document.querySelectorAll('[data-portal-section]').forEach((section) => {
        section.classList.toggle('is-active', section.dataset.portalSection === 'admin');
      });
    }
  } catch (error) {
    console.warn('Dashboard load failed', error);
  }
}

function renderSiteContent(content) {
  if (!content) return;
  appState.siteContent = content;
  const title = document.getElementById('hero-title');
  if (title && content.heroTitle) title.textContent = content.heroTitle;
  const heroSubtitle = document.querySelector('.hero .sub');
  if (heroSubtitle && content.heroSubtitle) heroSubtitle.textContent = content.heroSubtitle;
}

async function loadSiteContent() {
  if (DEMO_MODE) return;
  try {
    const content = await api('/api/public/site-content');
    renderSiteContent(content);
  } catch (error) {
    console.warn('Site content unavailable', error);
  }
}

async function submitOrder(event) {
  event.preventDefault();
  if (!els.orderForm?.reportValidity()) return;

  if (!appState.user) {
    showAuth('login', async () => {
      if (els.orderForm) {
        await submitOrder(new Event('submit'));
      }
    });
    return;
  }

  try {
    if (DEMO_MODE) {
      showSentState();
      return;
    }

    if (els.orderSubmit) {
      els.orderSubmit.disabled = true;
      els.orderSubmit.textContent = appState.referenceFiles.length ? 'Sending photos to June...' : 'Sending to June...';
    }
    const referenceImages = await uploadOrderReferenceImages(appState.referenceFiles);
    const payload = {
      name: document.getElementById('customerName')?.value?.trim() || '',
      contact: document.getElementById('contactInfo')?.value?.trim() || '',
      story: document.getElementById('orderDetails')?.value?.trim() || '',
      referenceImages,
      source: 'website',
    };
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    showSentState();
    await loadDashboardData();
    showDashboard();
  } catch (error) {
    alert(error.message || 'Could not place the order right now.');
  } finally {
    if (els.orderSubmit) {
      els.orderSubmit.disabled = false;
      els.orderSubmit.textContent = 'Seal and send to June';
    }
  }
}

async function uploadOrderReferenceImages(files = []) {
  if (!files.length) return [];
  const signature = await api('/api/uploads/cloudinary-signature', {
    method: 'POST',
    body: JSON.stringify({ folder: 'artorabyjune/order-references' }),
    headers: { 'Content-Type': 'application/json' },
  });

  return Promise.all(files.map(async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', signature.apiKey);
    formData.append('timestamp', signature.timestamp);
    formData.append('signature', signature.signature);
    formData.append('folder', signature.folder);
    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!uploadRes.ok) throw new Error('Could not upload a reference photo. Please try again.');
    const upload = await uploadRes.json();
    return upload.secure_url;
  }));
}

function renderReferencePreviews() {
  if (!els.referencePreview) return;
  if (document.getElementById('referenceCount')) {
    document.getElementById('referenceCount').textContent = `${appState.referenceFiles.length} of 5 photos added`;
  }
  els.referencePreview.innerHTML = appState.referenceFiles.map((file, index) => {
    if (!file.previewUrl) file.previewUrl = URL.createObjectURL(file);
    return `<button class="reference-thumb" type="button" data-remove-reference="${index}" aria-label="Remove ${escapeHtml(file.name)}"><img src="${file.previewUrl}" alt="Reference photo: ${escapeHtml(file.name)}"></button>`;
  }).join('');
}

function wireOrderReferences() {
  if (els.referenceImages) {
    els.referenceImages.addEventListener('change', () => {
      const selected = Array.from(els.referenceImages.files || []).filter((file) => file.type.startsWith('image/'));
      const room = Math.max(0, 5 - appState.referenceFiles.length);
      if (selected.length > room) alert('You can add up to five reference photos.');
      appState.referenceFiles.push(...selected.slice(0, room));
      els.referenceImages.value = '';
      renderReferencePreviews();
    });
  }
  if (els.referencePreview) {
    els.referencePreview.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-reference]');
      if (!button) return;
      const index = Number(button.dataset.removeReference);
      const [file] = appState.referenceFiles.splice(index, 1);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      renderReferencePreviews();
    });
  }
}

function showSentState() {
  if (!els.sentMsg) return;
  els.sentMsg.classList.remove('show');
  void els.sentMsg.offsetWidth;
  els.sentMsg.classList.add('show');
}

async function submitAuthForm(event) {
  event.preventDefault();
  const mode = appState.authMode;
  const email = document.getElementById('authEmail')?.value?.trim();
  const password = document.getElementById('authPassword')?.value || '';
  const name = document.getElementById('authName')?.value?.trim() || '';

  if (DEMO_MODE) {
    const role = email?.includes('admin') ? 'admin' : 'customer';
    setUser({ email, name: name || email?.split('@')[0] || 'Story holder' }, 'demo-token', role);
    saveDemoSession(appState.user);
    closeAuth();
    await loadDashboardData();
    appState.afterAuth?.();
    appState.afterAuth = null;
    return;
  }

  const endpoint = mode === 'signup' ? '/api/auth/register' : '/api/auth/login';
  const body = { email, password, name };
  const result = await api(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  setUser(result.user, result.token, result.role || 'customer');
  closeAuth();
  await loadDashboardData();
  if (appState.afterAuth) {
    const callback = appState.afterAuth;
    appState.afterAuth = null;
    callback();
  }
}

function wireTabs() {
  document.querySelectorAll('[data-portal-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.portalTab;
      document.querySelectorAll('[data-portal-tab]').forEach((tab) => tab.classList.toggle('is-active', tab === button));
      document.querySelectorAll('[data-portal-section]').forEach((section) => {
        section.classList.toggle('is-active', section.dataset.portalSection === target);
      });
    });
  });
}

function wireAdminTabs() {
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach((tab) => tab.classList.toggle('is-active', tab === button));
      document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.adminPanel === target);
      });
    });
  });
}

function wireCmsForms() {
  document.querySelectorAll('[data-cms-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (appState.role !== 'admin') return;
      const key = form.dataset.cmsForm;
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        if (DEMO_MODE) {
          alert(`Saved ${key} in demo mode.`);
          return;
        }
        await api(`/api/admin/content/${key}`, {
          method: 'PUT',
          body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' },
        });
        alert('Saved successfully.');
      } catch (error) {
        alert(error.message || 'Could not save content.');
      }
    });
  });

  document.querySelector('[data-save-settings]')?.addEventListener('click', () => {
    document.querySelectorAll('[data-cms-form]').forEach((form) => {
      form.requestSubmit();
    });
  });
}

async function saveAdminCollection(type) {
  if (appState.role !== 'admin') return;
  const items = getAdminTableItems(type)
    .map(({ id, ...rest }) => rest)
    .filter((item) => hasMeaningfulAdminContent(type, item));
  appState.adminData[type] = items;
  try {
    if (DEMO_MODE) {
      alert(`Saved ${type} in demo mode.`);
      return;
    }
    await api(`/api/admin/content/${type}`, {
      method: 'PUT',
      body: JSON.stringify(items),
      headers: { 'Content-Type': 'application/json' },
    });
    alert(`${type} saved.`);
    await loadDashboardData();
  } catch (error) {
    alert(error.message || `Could not save ${type}.`);
  }
}

async function saveAdminOrder(orderId, row) {
  const payload = {
    status: row.querySelector('[data-order-field="status"]')?.value || '',
    paymentStatus: row.querySelector('[data-order-field="paymentStatus"]')?.value || '',
    shippingUpdate: row.querySelector('[data-order-field="shippingUpdate"]')?.value.trim() || '',
  };
  try {
    if (DEMO_MODE) {
      alert('Order updated in demo mode.');
      return;
    }
    await api(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    await loadDashboardData();
  } catch (error) {
    alert(error.message || 'Could not update the order.');
  }
}

function wireAdminActions() {
  document.addEventListener('click', async (event) => {
    const addButton = event.target.closest('[data-add-row]');
    if (addButton) {
      const type = addButton.dataset.addRow;
      const current = appState.adminData[type] || [];
      renderCrudTable(type, [...current, createAdminItem(type)]);
      return;
    }

    const removeButton = event.target.closest('[data-remove-row]');
    if (removeButton) {
      const type = removeButton.dataset.removeRow;
      const rowId = removeButton.dataset.rowId;
      const next = (appState.adminData[type] || []).filter((item) => String(item.id) !== String(rowId));
      renderCrudTable(type, next);
      return;
    }

    const saveButton = event.target.closest('[data-save-table]');
    if (saveButton) {
      await saveAdminCollection(saveButton.dataset.saveTable);
      return;
    }

    const saveOrderButton = event.target.closest('[data-save-order]');
    if (saveOrderButton) {
      const row = saveOrderButton.closest('tr');
      if (row) await saveAdminOrder(saveOrderButton.dataset.saveOrder, row);
      return;
    }

    const refreshOrdersButton = event.target.closest('[data-refresh-orders]');
    if (refreshOrdersButton) {
      await loadDashboardData();
    }
  });
}

function wireCloudinaryUploads() {
  document.querySelectorAll('[data-cloudinary-upload]').forEach((button) => {
    button.addEventListener('click', async () => {
      const form = button.closest('[data-cms-form="media"]');
      const fileInput = form?.querySelector('[data-cloudinary-file]');
      const file = fileInput?.files?.[0];
      if (!file) {
        alert('Choose an image file first.');
        return;
      }
      try {
        if (DEMO_MODE) {
          const url = URL.createObjectURL(file);
          const target = form.querySelector('input[name="galleryImage"]');
          if (target) target.value = url;
          alert('Demo upload complete.');
          return;
        }
        const signature = await api('/api/uploads/cloudinary-signature', {
          method: 'POST',
          body: JSON.stringify({ folder: 'artorabyjune' }),
          headers: { 'Content-Type': 'application/json' },
        });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('api_key', signature.apiKey);
        formData.append('timestamp', signature.timestamp);
        formData.append('signature', signature.signature);
        formData.append('folder', signature.folder);
        const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) throw new Error('Cloudinary upload failed.');
        const uploadJson = await uploadRes.json();
        const target = form.querySelector('input[name="galleryImage"]');
        if (target) target.value = uploadJson.secure_url;
        alert('Image uploaded.');
      } catch (error) {
        alert(error.message || 'Could not upload the image.');
      }
    });
  });
}

function wireProfileForm() {
  const profileForm = document.getElementById('profileForm');
  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      displayName: document.getElementById('profileName')?.value?.trim() || '',
      pronouns: document.getElementById('profilePronouns')?.value?.trim() || '',
      bio: document.getElementById('profileBio')?.value?.trim() || '',
    };
    try {
      if (DEMO_MODE) {
        alert('Profile saved in demo mode.');
        return;
      }
      await api('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      alert('Profile saved.');
    } catch (error) {
      alert(error.message || 'Could not save profile.');
    }
  });
}

function wirePortalButtons() {
  document.querySelector('[data-close-auth]')?.addEventListener('click', closeAuth);
  document.querySelector('[data-close-dashboard]')?.addEventListener('click', closeDashboard);
  document.querySelectorAll('[data-auth-switch]').forEach((button) => {
    button.addEventListener('click', () => showAuth(button.dataset.authSwitch));
  });
  document.querySelector('[data-google-signin]')?.addEventListener('click', () => {
    if (DEMO_MODE) {
      alert('Google sign-in will work after the backend OAuth route is configured.');
      return;
    }
    window.location.href = `${API_BASE}/api/auth/google/start?returnTo=${encodeURIComponent(window.location.href)}`;
  });
}

function wireOrderGate() {
  if (els.orderForm) {
    els.orderForm.addEventListener('submit', submitOrder);
  }
}

function wireGlobalAuth() {
  document.getElementById('openAuth')?.addEventListener('click', () => {
    if (appState.user) {
      showDashboard();
      return;
    }
    showAuth('login');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAuth();
      closeDashboard();
    }
  });
}

window.addEventListener('load', () => {
  assetsReady = true;
  maybeFinishLoading();
}, { once: true });

function wirePrimaryNav() {
  const navLinks = Array.from(document.querySelectorAll('.navlinks a[href^="#"]'));
  if (!navLinks.length) return;

  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  const header = document.querySelector('header');

  const setActive = (id) => {
    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${id}`;
      if (active) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const getActiveSection = () => {
    const offset = (header?.offsetHeight || 0) + 28;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= offset) current = section;
    }
    return current;
  };

  const updateActive = () => {
    const current = getActiveSection();
    if (current?.id) setActive(current.id);
  };

  updateActive();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('scroll', updateActive, { passive: true });
    return;
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      updateActive();
      ticking = false;
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateActive, { passive: true });
}

function observeReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach((element) => element.classList.add('show'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.reveal').forEach((element) => io.observe(element));
}

function wireDemoFallback() {
  if (!DEMO_MODE) return;
  if (!appState.user) {
    setUser(null, null, 'guest');
  }
}

async function init() {
  buildLoadingText();
  ensurePortals();
  wireTabs();
  wireAdminTabs();
  wireCmsForms();
  wireAdminActions();
  wireCloudinaryUploads();
  wireProfileForm();
  wirePortalButtons();
  wireOrderGate();
  wireOrderReferences();
  wireGlobalAuth();
  wirePrimaryNav();
  observeReveal();
  wireDemoFallback();
  await loadSiteContent();
  await loadSession();
  appReady = true;
  maybeFinishLoading();
}

init().catch((error) => {
  console.error(error);
  appReady = true;
  maybeFinishLoading();
});
