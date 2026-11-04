import { $, $$, esc, prefersReducedMotion } from './dom.js';

// ---------- Toasts ----------
export function toast(message, { type = 'info', timeout = 4200 } = {}) {
  const stack = $('[data-toasts]');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' is-error' : ''}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(message)}</span>`;
  stack.appendChild(el);
  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', close);
  setTimeout(close, timeout);
}
export const toastError = (error) => toast(error?.message || String(error), { type: 'error', timeout: 6000 });

// ---------- Focus trap ----------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trap(container, event) {
  if (event.key !== 'Tab') return;
  const items = $$(FOCUSABLE, container).filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

// ---------- Sheets (side drawers) ----------
let openSheet = null;
let lastFocus = null;

export function showSheet(sheet) {
  if (!sheet) return;
  if (openSheet && openSheet !== sheet) hideSheet(openSheet, false);
  lastFocus = document.activeElement;
  openSheet = sheet;
  sheet.inert = false;
  sheet.setAttribute('aria-hidden', 'false');
  sheet.classList.add('is-open');
  $('[data-sheet-backdrop]').hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => ($(FOCUSABLE, sheet) || sheet).focus());
  sheet._trap = (e) => trap(sheet, e);
  sheet.addEventListener('keydown', sheet._trap);
}

export function hideSheet(sheet = openSheet, restore = true) {
  if (!sheet) return;
  sheet.classList.remove('is-open');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.inert = true;
  sheet.removeEventListener('keydown', sheet._trap);
  $('[data-sheet-backdrop]').hidden = true;
  document.body.style.overflow = '';
  $$('[aria-controls="mobileMenu"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (openSheet === sheet) openSheet = null;
  if (restore && lastFocus) lastFocus.focus?.();
}

export function wireSheets() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]') || e.target.matches('[data-sheet-backdrop]')) hideSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openSheet) hideSheet();
  });
}

// ---------- Modal ----------
export function openModal({ title, body, onOpen, wide = false }) {
  const backdrop = $('[data-modal]');
  const modal = $('.modal', backdrop);
  $('[data-modal-title]', backdrop).textContent = title;
  const bodyEl = $('[data-modal-body]', backdrop);
  bodyEl.innerHTML = body;
  modal.style.width = wide ? 'min(980px, 100%)' : '';
  const previous = document.activeElement;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    trap(modal, e);
  };
  function close() {
    backdrop.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    previous?.focus?.();
  }
  document.addEventListener('keydown', onKey);
  backdrop.onclick = (e) => { if (e.target === backdrop || e.target.closest('[data-modal-close]')) close(); };
  requestAnimationFrame(() => ($(FOCUSABLE, bodyEl) || modal).focus());
  onOpen?.(bodyEl, close);
  return close;
}

// ---------- Buttons ----------
export async function busy(button, fn, label) {
  if (!button) return fn();
  const original = button.innerHTML;
  button.classList.add('is-busy');
  button.disabled = true;
  if (label) button.textContent = label;
  try {
    return await fn();
  } finally {
    button.classList.remove('is-busy');
    button.disabled = false;
    button.innerHTML = original;
  }
}

// ---------- Field errors ----------
export function clearErrors(form) {
  $$('.field-error', form).forEach((el) => el.remove());
  $$('[aria-invalid="true"]', form).forEach((el) => el.removeAttribute('aria-invalid'));
}

export function showFieldError(form, name, message) {
  const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
  if (!input) return false;
  input.setAttribute('aria-invalid', 'true');
  const err = document.createElement('span');
  err.className = 'field-error';
  err.id = `${input.id || name.replace(/\W/g, '')}-err`;
  err.textContent = message;
  input.setAttribute('aria-describedby', err.id);
  (input.closest('.field, .letter-field, label') || input).after(err);
  input.focus();
  return true;
}

// Native validation with friendly messages, shown inline.
export function validateForm(form) {
  clearErrors(form);
  const invalid = $$('input, select, textarea', form).filter((el) => !el.disabled && el.offsetParent !== null && !el.checkValidity());
  if (!invalid.length) return true;
  const el = invalid[0];
  let message = el.validationMessage;
  if (el.validity.valueMissing) message = 'This one’s needed.';
  if (el.validity.typeMismatch && el.type === 'email') message = 'Please enter a valid email address.';
  if (el.validity.tooShort) message = `Please write at least ${el.minLength} characters.`;
  showFieldError(form, el.name, message);
  return false;
}

export function handleFormError(form, error) {
  if (error?.data?.field && showFieldError(form, error.data.field, error.message)) return;
  toastError(error);
}

// ---------- Paint splat ----------
const SPLAT_COLOURS = ['#C1443C', '#3A4CA6', '#C98A2A', '#6C7C5C'];
export function splat(x, y, count = 10) {
  if (prefersReducedMotion()) return;
  for (let i = 0; i < count; i += 1) {
    const s = document.createElement('span');
    s.className = 'splat';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 26 + Math.random() * 34;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.background = SPLAT_COLOURS[i % SPLAT_COLOURS.length];
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 720);
  }
}

// ---------- Scroll reveal ----------
let io;
export function reveal(root = document) {
  const items = $$('.reveal:not(.show)', root);
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('show'));
    return;
  }
  io = io || new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  items.forEach((el) => io.observe(el));
}
