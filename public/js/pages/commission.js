import { $, $$, html, raw, esc, inr, fmtDate, debounce } from '../core/dom.js';
import { post } from '../core/api.js';
import { read, write, remove } from '../core/store.js';
import { initLayout, bootstrap, session } from '../core/layout.js';
import { toast, toastError, showFieldError, clearErrors, validateForm } from '../core/ui.js';
import { uploadImage } from '../core/upload.js';

initLayout();

const DRAFT_KEY = 'artora.commission.draft';
const form = $('[data-commission]');
const steps = $$('[data-step]', form);
const stepper = $$('[data-stepper] li');
const btnNext = $('[data-next]');
const btnPrev = $('[data-prev]');
const btnSubmit = $('[data-submit]');
let current = 1;
let tiers = [];
let site = {};

// Each reference: { id, previewUrl, url (once uploaded), uploading, error }
const refs = [];

const state = {
  tier: '',
  style: 'Tote',
  baseColour: 'Natural',
  occasion: '',
  moods: [],
};

// ---------- Draft (saves as you write) ----------
function collectDraft() {
  return {
    ...state,
    story: form.story.value,
    include: form.include.value,
    name: form.name.value,
    email: form.email.value,
    phone: form.phone.value,
    deadline: form.deadline.value,
    isGift: form.isGift.checked,
    giftNote: form.giftNote.value,
    giftWrap: form.giftWrap.checked,
    references: refs.filter((r) => r.url).map((r) => r.url),
  };
}
const saveDraft = debounce(() => {
  write(DRAFT_KEY, collectDraft());
  const hint = $('[data-save-hint]');
  if (hint) hint.textContent = 'Draft saved on this device.';
}, 400);

function applyDraft(d) {
  if (!d) return;
  Object.assign(state, {
    tier: d.tier || state.tier,
    style: d.style || state.style,
    baseColour: d.baseColour || state.baseColour,
    occasion: d.occasion || '',
    moods: Array.isArray(d.moods) ? d.moods : [],
  });
  ['story', 'include', 'name', 'email', 'phone', 'deadline', 'giftNote'].forEach((k) => { if (d[k]) form[k].value = d[k]; });
  form.isGift.checked = Boolean(d.isGift);
  form.giftWrap.checked = Boolean(d.giftWrap);
  (d.references || []).slice(0, 5).forEach((url) => refs.push({ id: crypto.randomUUID?.() || String(Math.random()), previewUrl: url, url }));
}

// ---------- Choice chips ----------
function syncChips() {
  $$('[data-choice]', form).forEach((group) => {
    const key = group.dataset.choice;
    $$('.chip', group).forEach((chip) => {
      const on = state[key] === chip.dataset.value;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  });
  $$('[data-multi]', form).forEach((group) => {
    const key = group.dataset.multi;
    $$('.chip', group).forEach((chip) => {
      const on = state[key].includes(chip.dataset.value);
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  });
  $$('input[name="tier"]', form).forEach((input) => { input.checked = input.value === state.tier; });
  $('[data-gift-fields]').hidden = !form.isGift.checked;
}

form.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const single = chip.closest('[data-choice]');
  const multi = chip.closest('[data-multi]');
  if (single) {
    const key = single.dataset.choice;
    const allowEmpty = single.hasAttribute('data-allow-empty');
    state[key] = allowEmpty && state[key] === chip.dataset.value ? '' : chip.dataset.value;
  } else if (multi) {
    const key = multi.dataset.multi;
    const v = chip.dataset.value;
    state[key] = state[key].includes(v) ? state[key].filter((x) => x !== v) : [...state[key], v].slice(0, 4);
  }
  syncChips();
  saveDraft();
});

form.addEventListener('input', saveDraft);
form.addEventListener('change', (e) => {
  if (e.target.name === 'tier') state.tier = e.target.value;
  if (e.target.name === 'isGift') $('[data-gift-fields]').hidden = !e.target.checked;
  if (e.target.name === 'deadline') deadlineHint();
  saveDraft();
});

// ---------- Tiers ----------
function renderTiers() {
  $('[data-tier-options]').innerHTML = tiers.map((t) => html`
    <label class="tier-option">
      <input type="radio" name="tier" value="${t.key}" ${state.tier === t.key ? 'checked' : ''}>
      ${t.featured ? raw('<span class="tape tape-cherry">most loved</span>') : ''}
      <strong>${t.title}</strong>
      <span class="from">from ${inr(t.price)}</span>
      <small>${(t.features || []).slice(0, 2).join(' · ')}</small>
      <small>${t.turnaround}</small>
    </label>`).join('');
}

// ---------- Deadline hint ----------
function deadlineHint() {
  const el = $('[data-deadline-hint]');
  const value = form.deadline.value;
  if (!value) { el.textContent = ''; return; }
  const tier = tiers.find((t) => t.key === state.tier);
  const paintDays = Number(tier?.days) || 7;
  const deliveryMax = Number(String(site.deliveryDays || '3–7').split(/[–-]/).pop()) || 7;
  const sketchDays = 2;
  const need = sketchDays + paintDays + deliveryMax;
  const daysLeft = Math.ceil((new Date(value) - new Date()) / 86400000);
  if (daysLeft < 0) el.innerHTML = '<span style="color:var(--cherry)">That date has passed.</span>';
  else if (daysLeft < need) el.innerHTML = esc(`That’s tight: ${tier?.title || 'this tier'} usually needs about ${need} days door to door. Mention it in your story and June will tell you honestly if she can make it.`);
  else el.textContent = `Lovely, that gives June comfortable time (about ${need} days needed).`;
}

// ---------- Reference photos ----------
function renderRefs() {
  $('[data-ref-count]').textContent = `${refs.length} of 5 photos added`;
  $('[data-ref-preview]').innerHTML = refs.map((r) => html`
    <button class="reference-thumb${r.uploading ? ' is-uploading' : ''}" type="button" data-remove-ref="${r.id}" aria-label="Remove photo">
      <img src="${r.previewUrl}" alt="Reference photo">
    </button>`).join('');
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  const room = 5 - refs.length;
  if (!files.length) return;
  if (files.length > room) toast(room ? `Only ${room} more photo${room === 1 ? '' : 's'} can be added.` : 'Five photos is the limit.', { type: 'error' });
  for (const file of files.slice(0, Math.max(0, room))) {
    const ref = { id: crypto.randomUUID?.() || String(Math.random()), previewUrl: URL.createObjectURL(file), uploading: true };
    refs.push(ref);
    renderRefs();
    uploadImage(file, 'references')
      .then((url) => { ref.url = url; ref.uploading = false; renderRefs(); saveDraft(); })
      .catch((error) => {
        refs.splice(refs.indexOf(ref), 1);
        renderRefs();
        toastError(error);
      });
  }
}

const refInput = $('[data-ref-input]');
refInput.addEventListener('change', () => { addFiles(refInput.files); refInput.value = ''; });
const drop = $('[data-dropzone]');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-drag'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-drag'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
$('[data-ref-preview]').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-ref]');
  if (!btn) return;
  const i = refs.findIndex((r) => r.id === btn.dataset.removeRef);
  if (i >= 0) refs.splice(i, 1);
  renderRefs();
  saveDraft();
});

// ---------- Steps ----------
function validateStep(n) {
  clearErrors(form);
  if (n === 1 && !state.tier) {
    toast('Choose a canvas size to continue.', { type: 'error' });
    $('input[name="tier"]', form)?.focus();
    return false;
  }
  if (n === 2) {
    if (form.story.value.trim().length < 10) {
      showFieldError(form, 'story', 'Tell June a little more — even a sentence or two helps.');
      return false;
    }
  }
  if (n === 3 && refs.some((r) => r.uploading)) {
    toast('Hang on, your photos are still uploading.');
    return false;
  }
  if (n === 4) return validateForm($('[data-step="4"]'));
  return true;
}

function renderReview() {
  const d = collectDraft();
  const tier = tiers.find((t) => t.key === d.tier);
  const rows = [
    ['Canvas', `${tier?.title || '—'} · ${d.style} · ${d.baseColour}`],
    d.occasion && ['Occasion', d.occasion],
    ['Your story', d.story],
    d.include && ['Include', d.include],
    d.moods.length && ['Mood', d.moods.join(', ')],
    ['Signed', `${d.name} · ${d.email}${d.phone ? ` · ${d.phone}` : ''}`],
    d.deadline && ['Needed by', fmtDate(d.deadline)],
    d.isGift && ['Gift', `${d.giftNote || 'Yes'}${d.giftWrap ? ' · gift wrapped' : ''}`],
  ].filter(Boolean);
  $('[data-review]').innerHTML = html`
    <dl>${rows.map(([k, v]) => raw(html`<dt>${k}</dt><dd>${v}</dd>`))}</dl>
    ${refs.length ? raw(html`<div class="thumbs">${refs.map((r) => raw(html`<img src="${r.previewUrl}" alt="">`))}</div>`) : ''}
    <p class="helper-note">Starts from <strong>${inr(tier?.price || 0)}</strong>. June confirms the final price with your sketch.</p>`;
}

function go(n) {
  current = Math.max(1, Math.min(5, n));
  steps.forEach((s) => s.classList.toggle('is-active', Number(s.dataset.step) === current));
  stepper.forEach((li, i) => {
    li.classList.toggle('is-done', i + 1 < current);
    li.classList.toggle('is-current', i + 1 === current);
    if (i + 1 === current) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
  btnPrev.hidden = current === 1;
  btnNext.hidden = current === 5;
  btnSubmit.hidden = current !== 5;
  if (current === 5) renderReview();
  const top = $('[data-stepper]').getBoundingClientRect().top + window.scrollY - 90;
  if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  $('.letter-step.is-active legend')?.setAttribute('tabindex', '-1');
  $('.letter-step.is-active legend')?.focus({ preventScroll: true });
}

btnNext.addEventListener('click', () => { if (validateStep(current)) go(current + 1); });
btnPrev.addEventListener('click', () => go(current - 1));
form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && current < 5) {
    e.preventDefault();
    btnNext.click();
  }
});

// ---------- Submit ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (current !== 5) return;
  for (let n = 1; n <= 4; n += 1) {
    if (!validateStep(n)) { go(n); validateStep(n); return; }
  }
  const d = collectDraft();
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Sealing your letter…';
  try {
    const result = await post('/commissions', {
      tier: d.tier,
      style: d.style,
      baseColour: d.baseColour,
      occasion: d.occasion,
      story: d.story,
      include: d.include,
      moods: d.moods,
      references: d.references,
      deadline: d.deadline,
      name: d.name,
      email: d.email,
      phone: d.phone,
      gift: { isGift: d.isGift, note: d.giftNote, wrap: d.giftWrap },
    });
    remove(DRAFT_KEY);
    $('[data-sealed-number]').textContent = result.number;
    $('[data-sealed-email]').textContent = d.email;
    $('[data-sealed-link]').href = `/order/${encodeURIComponent(result.number)}?t=${encodeURIComponent(result.token)}`;
    $('.commission-layout').hidden = true;
    $('[data-stepper]').hidden = true;
    $('.page-hero').hidden = true;
    $('[data-sealed]').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Seal and send to June';
    const field = error?.data?.field;
    const stepFor = { tier: 1, story: 2, include: 2, name: 4, email: 4, phone: 4, deadline: 4 };
    if (field && stepFor[field]) {
      go(stepFor[field]);
      showFieldError(form, field, error.message);
    } else toastError(error);
  }
});

// ---------- Start ----------
(async () => {
  const boot = await bootstrap();
  tiers = boot.tiers || [];
  site = boot.site || {};
  const params = new URLSearchParams(location.search);
  state.tier = tiers.find((t) => t.featured)?.key || tiers[0]?.key || '';
  applyDraft(read(DRAFT_KEY));
  if (params.get('tier') && tiers.some((t) => t.key === params.get('tier'))) state.tier = params.get('tier');
  if (params.get('occasion')) state.occasion = params.get('occasion');
  if (params.get('memory')) form.story.value = params.get('memory');

  const user = await session();
  if (user) {
    if (!form.name.value) form.name.value = user.name || '';
    if (!form.email.value) form.email.value = user.email || '';
    if (!form.phone.value) form.phone.value = user.phone || '';
  }
  if (site.depositPercent) $('[data-deposit-copy]').textContent = `${site.depositPercent}% to begin`;
  if (site.giftWrapFee) $('[data-giftwrap-fee]').textContent = `(+${inr(site.giftWrapFee)})`;
  form.deadline.min = new Date().toISOString().slice(0, 10);

  renderTiers();
  syncChips();
  renderRefs();
  deadlineHint();
  go(1);
  window.scrollTo(0, 0);
})();
