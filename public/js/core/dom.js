export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Tagged template that escapes every interpolated value unless wrapped in raw().
const RAW = Symbol('raw');
export const raw = (value) => ({ [RAW]: true, value: String(value ?? '') });
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    if (i >= values.length) return out + str;
    const v = values[i];
    let piece;
    if (Array.isArray(v)) piece = v.map((x) => (x && x[RAW] ? x.value : esc(x))).join('');
    else if (v && v[RAW]) piece = v.value;
    else if (v === false || v === null || v === undefined) piece = '';
    else piece = esc(v);
    return out + str + piece;
  }, '');
}

export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export function fmtDate(value, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', opts);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'radio') { if (!el.checked) continue; value = el.value; }
    else value = el.value.trim();
    // "address.city" → { address: { city } }
    const keys = el.name.split('.');
    let target = out;
    keys.slice(0, -1).forEach((k) => { target[k] = target[k] || {}; target = target[k]; });
    target[keys[keys.length - 1]] = value;
  }
  return out;
}
