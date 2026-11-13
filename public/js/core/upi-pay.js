// The UPI payment panel, used at checkout and on the order page (deposit, balance, rest due).
// The customer pays June's UPI ID (QR code or app button), then sends the 12-digit UTR and a
// screenshot. June matches it with her bank and confirms by email.
import { post } from './api.js';
import { html, raw, inr, esc } from './dom.js';
import { toast, toastError } from './ui.js';
import { compressImage } from './upload.js';

const UA = navigator.userAgent || '';
const isAndroid = /Android/i.test(UA);
const isIOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const isPhone = isAndroid || isIOS;

const UTR_RE = /^\d{12}$/;
const cleanUtr = (v) => String(v || '').replace(/[\s-]/g, '');
const validUtr = (v) => UTR_RE.test(v) && !/^(\d)\1{11}$/.test(v);

const KIND_WORD = { full: 'payment', deposit: 'deposit', balance: 'balance' };

const APPS = [
  { key: 'gpay', name: 'Google Pay', android: 'com.google.android.apps.nbu.paisa.user', ios: 'gpay://upi/pay' },
  { key: 'phonepe', name: 'PhonePe', android: 'com.phonepe.app', ios: 'phonepe://pay' },
  { key: 'paytm', name: 'Paytm', android: 'net.one97.paytm', ios: 'paytmmp://pay' },
];

function appLink(app, query) {
  if (isAndroid) return `intent://pay?${query}#Intent;scheme=upi;package=${app.android};end`;
  return `${app.ios}?${query}`;
}

const storeKey = (number) => `artora.proof.${number}`;
const readStored = (number) => { try { return JSON.parse(sessionStorage.getItem(storeKey(number)) || 'null'); } catch { return null; } };
const writeStored = (number, value) => { try { if (value) sessionStorage.setItem(storeKey(number), JSON.stringify(value)); else sessionStorage.removeItem(storeKey(number)); } catch { /* private mode */ } };

// ---------- Screenshot reader (optional help, never required) ----------
let tesseractLoad;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tesseractLoad = tesseractLoad || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/tesseract/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tesseractLoad = null; reject(new Error('reader unavailable')); };
    document.head.appendChild(s);
  });
  return tesseractLoad;
}

// UPI apps label the reference differently. Prefer a 12-digit number near one of these words;
// fall back to every 12-digit number on the screen, so the customer can pick.
const LABELS = /(UTR|UPI\s*Ref(?:erence)?(?:\s*No\.?)?|UPI\s*transaction\s*ID|Ref(?:erence)?\s*No\.?|RRN)/i;
export function findUtrCandidates(text) {
  const lines = String(text || '').split(/\n+/);
  const near = [];
  const all = [];
  lines.forEach((line, i) => {
    const nums = (line.replace(/(\d)[\s-](?=\d)/g, '$1').match(/(?<!\d)\d{12}(?!\d)/g) || []).filter(validUtr);
    all.push(...nums);
    const context = `${lines[i - 1] || ''} ${line}`;
    if (LABELS.test(context)) near.push(...nums);
  });
  const unique = (list) => [...new Set(list)];
  return { best: unique(near), all: unique(all) };
}

async function readScreenshot(file, onProgress) {
  const Tesseract = await loadTesseract();
  const base = `${location.origin}/vendor/tesseract`;
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${base}/lang`,
    gzip: true,
    workerBlobURL: false,
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text || '';
  } finally {
    worker.terminate();
  }
}

// ---------- The scout: the kitten detective, shown while the screenshot is read ----------
// Three transparent clips in /assets/kitty: a searching loop, "found" and "puzzled". Decorative only
// (aria-hidden); the caption and the note under the UTR say the same in words.
//   Chrome, Android, Firefox, Edge: WebM with an alpha channel (smallest).
//   Safari and every iPhone browser: WebKit can't show WebM transparency, so animated WebP instead.
//   Reduced motion or data saver: one still picture per state.
const KITTY = '/assets/kitty';
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SAVE_DATA = Boolean(navigator.connection?.saveData);
const STILL_ONLY = REDUCED_MOTION || SAVE_DATA;
const IS_WEBKIT = isIOS || (/Safari\//.test(UA) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/.test(UA));
const KITTY_MODE = STILL_ONLY ? 'still' : IS_WEBKIT ? 'webp' : 'video';
const SEARCH_LOOP_MS = 1080; // length of searching.webm / searching-anim.webp
// The search always gets at least this long, and always finishes the loop it's on.
const SCOUT_MIN_MS = 1800;
const SCOUT_HOLD_MS = 1700;

// ---------- Upload ----------
async function uploadScreenshot(file, { number, token }) {
  const blob = await compressImage(file);
  const sign = await post(`/orders/${encodeURIComponent(number)}/payment-proof/sign`, { t: token });
  if (sign.provider === 'cloudinary') {
    const fd = new FormData();
    fd.append('file', blob, 'payment.jpg');
    fd.append('api_key', sign.apiKey);
    fd.append('timestamp', sign.timestamp);
    fd.append('signature', sign.signature);
    fd.append('public_id', sign.public_id);
    fd.append('type', sign.type);
    fd.append('allowed_formats', sign.allowed_formats);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sign.cloudName)}/image/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('The screenshot didn’t upload. Please try again.');
    const json = await res.json();
    return { publicId: json.public_id, version: json.version, signature: json.signature };
  }
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const result = await post(`/orders/${encodeURIComponent(number)}/payment-proof/local`, { t: token, publicId: sign.publicId, data });
  return { publicId: result.publicId };
}

// ---------- Panel ----------
function qrImg(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Renders the panel into `container`.
 * payment: the server's UPI payload { kind, amount, upiId, upiName, upiUri, qrSvg, reference }
 * onSubmitted(order): called after the proof is accepted (the order is now "being checked").
 */
export function renderUpiPanel(container, { payment, number, token, onSubmitted, heading }) {
  if (!payment) { container.innerHTML = ''; return; }
  const word = KIND_WORD[payment.kind] || 'payment';
  if (!payment.upiId) {
    container.innerHTML = html`<div class="upi-pay"><p class="mail-hint">${payment.message || 'June will send payment details by email shortly.'}</p></div>`;
    return;
  }
  const query = payment.upiUri.replace(/^upi:\/\/pay\?/, '');
  container.innerHTML = html`
    <div class="upi-pay" data-upi>
      ${heading ? raw(html`<h2 class="upi-heading">${heading}</h2>`) : ''}
      <div class="upi-grid">
        <figure class="upi-slip receipt" aria-label="Payment details">
          <p class="receipt-head">Pay by UPI · ${payment.reference}</p>
          <p class="upi-amount"><small>${word}</small>${inr(payment.amount)}</p>
          ${isPhone ? raw(html`
            <div class="upi-apps is-first">
              <a class="btn btn-primary btn-block upi-pay-btn" href="${payment.upiUri}" data-app="any">Pay ${inr(payment.amount)} in your UPI app</a>
              <p class="upi-apps-or">or open
                ${raw(APPS.map((a) => html`<a href="${appLink(a, query)}" data-app="${a.key}">${a.name}</a>`).join('<span aria-hidden="true"> · </span>'))}
              </p>
              <p class="upi-app-miss" data-app-miss hidden>That app didn’t open. Try another one above, or copy the UPI ID below into any UPI app.</p>
            </div>
            <details class="upi-qr-more">
              <summary>Paying from another phone? Show the QR code</summary>
              <img class="upi-qr" src="${qrImg(payment.qrSvg)}" alt="UPI QR code to pay ${inr(payment.amount)} to ${payment.upiName}" width="196" height="196">
            </details>`) : raw(html`
            <img class="upi-qr" src="${qrImg(payment.qrSvg)}" alt="UPI QR code to pay ${inr(payment.amount)} to ${payment.upiName}" width="196" height="196">
            <p class="upi-scan">Scan with any UPI app</p>`)}
          <dl class="upi-lines">
            <dt>To</dt><dd>${payment.upiName}</dd>
            <dt>UPI ID</dt><dd><span class="upi-id">${payment.upiId}</span> <button class="link-copy" type="button" data-copy-upi>copy</button></dd>
            <dt>Note</dt><dd>${payment.reference}</dd>
          </dl>
        </figure>

        <form class="upi-proof crumpled" data-proof novalidate>
          <h3>Paid? Tell June.</h3>
          <p class="upi-nudge" data-nudge hidden>Welcome back. If the payment went through, add the UTR and a screenshot below.</p>
          <div class="field">
            <label for="utr-${esc(number)}">UTR (12-digit UPI reference)</label>
            <input id="utr-${esc(number)}" name="utr" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="e.g. 412345678901" required>
            <span class="upi-ocr-note" data-ocr-note hidden></span>
            <div class="upi-ocr-pick" data-ocr-pick hidden></div>
          </div>
          <div class="field">
            <span class="field-label" id="shot-label-${esc(number)}">Payment screenshot</span>
            <label class="upi-shot" data-shot>
              <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" aria-labelledby="shot-label-${esc(number)}">
              <span class="upi-shot-empty" data-shot-empty>Tap to add the screenshot of your successful payment</span>
              <img data-shot-preview alt="Your payment screenshot" hidden>
              <span class="ocr-scout" data-ocr-scout hidden aria-hidden="true">
                <span class="ocr-scan"></span>
                <span class="scout-wrap">
                  ${KITTY_MODE === 'video'
                    ? raw(`<video class="scout-kitty" data-scout-kitty muted playsinline preload="none" disablepictureinpicture poster="${KITTY}/searching.webp" width="320" height="252"></video>`)
                    : raw(`<img class="scout-kitty" data-scout-kitty src="${KITTY}/searching.webp" alt="" width="320" height="252" decoding="async">`)}
                  <span class="scout-ask" aria-hidden="true">?</span>
                </span>
                <span class="ocr-caption" data-ocr-caption>Looking for your UTR…</span>
              </span>
            </label>
            <span class="upi-shot-status" data-shot-status></span>
          </div>
          <details class="upi-help">
            <summary>Where do I find the UTR?</summary>
            <ul>
              <li><strong>Google Pay:</strong> open the payment, look for “UPI transaction ID”.</li>
              <li><strong>PhonePe:</strong> open the payment, then “Transfer details”. Use the 12-digit “UTR”, not the “Transaction ID” that starts with T.</li>
              <li><strong>Paytm:</strong> open the payment, look for “UPI Ref No.”</li>
              <li><strong>Bank app:</strong> often called “RRN” or “Reference number”.</li>
            </ul>
          </details>
          <button class="btn btn-primary btn-block" type="submit" data-send>Send payment details</button>
          <p class="mail-hint upi-truth">Paying by UPI isn’t the same as a confirmed order. June checks every payment with her bank, usually within a few hours, and emails you.</p>
        </form>
      </div>
    </div>`;
  wirePanel(container, { payment, number, token, onSubmitted });
}

function wirePanel(root, { payment, number, token, onSubmitted }) {
  const form = root.querySelector('[data-proof]');
  const utrInput = form.utr;
  const fileInput = form.screenshot;
  const statusEl = root.querySelector('[data-shot-status]');
  const preview = root.querySelector('[data-shot-preview]');
  const empty = root.querySelector('[data-shot-empty]');
  const ocrNote = root.querySelector('[data-ocr-note]');
  const ocrPick = root.querySelector('[data-ocr-pick]');
  let uploaded = readStored(number);
  let uploading = null;
  let typedByHand = false;
  let scanId = 0;
  const shotBox = root.querySelector('[data-shot]');
  const scoutEl = root.querySelector('[data-ocr-scout]');
  const caption = root.querySelector('[data-ocr-caption]');
  const kitty = scoutEl.querySelector('[data-scout-kitty]');
  const isVideo = KITTY_MODE === 'video';
  let loopStarted = 0; // when the animated WebP loop began (it has no "ended" event)
  const webpCache = {};
  // Animated WebP only restarts from frame one with a fresh URL, so keep each file as a blob.
  const webpUrl = async (name) => {
    webpCache[name] ||= fetch(`${KITTY}/${name}-anim.webp`).then((r) => r.blob()).catch(() => null);
    const blob = await webpCache[name];
    return blob ? URL.createObjectURL(blob) : `${KITTY}/${name}-anim.webp`;
  };
  const setClip = async (name, { loop = false } = {}) => {
    if (KITTY_MODE === 'still') {
      kitty.src = `${KITTY}/${name === 'searching' ? 'searching' : `${name}-end`}.webp`;
      return;
    }
    if (isVideo) {
      kitty.loop = loop;
      kitty.src = `${KITTY}/${name}.webm`;
      kitty.load();
      kitty.play().catch(() => {}); // autoplay blocked (e.g. low-power mode): the poster still shows
      return;
    }
    const url = await webpUrl(name);
    if (kitty.src.startsWith('blob:')) URL.revokeObjectURL(kitty.src);
    kitty.src = url;
    loopStarted = Date.now();
  };
  // Let the searching loop play to its end before the answer, so the animation never cuts off.
  const finishLoop = () => new Promise((resolve) => {
    if (KITTY_MODE === 'still') { resolve(); return; }
    if (!isVideo) {
      const into = (Date.now() - loopStarted) % SEARCH_LOOP_MS;
      setTimeout(resolve, SEARCH_LOOP_MS - into);
      return;
    }
    if (kitty.paused || kitty.readyState < 2) { resolve(); return; }
    const done = () => { clearTimeout(cap); kitty.removeEventListener('ended', done); resolve(); };
    const cap = setTimeout(done, SEARCH_LOOP_MS + 400);
    kitty.loop = false;
    kitty.addEventListener('ended', done);
  });
  // Start fetching the searching clip as soon as they tap to choose a screenshot.
  let warmed = false;
  fileInput.addEventListener('click', () => {
    if (warmed || KITTY_MODE === 'still') return;
    warmed = true;
    if (isVideo) { kitty.preload = 'auto'; kitty.src = `${KITTY}/searching.webm`; kitty.load(); } else webpUrl('searching');
  });
  const hideScout = () => { scanId += 1; if (isVideo) kitty.pause(); scoutEl.hidden = true; shotBox.classList.remove('is-scouting'); };
  // Starts the kitty for one reading; a newer screenshot takes over and the old one goes quiet.
  const startScout = () => {
    const id = ++scanId;
    const started = Date.now();
    scoutEl.classList.remove('is-found', 'is-lost', 'is-asking', 'is-leaving');
    scoutEl.hidden = false;
    shotBox.classList.add('is-scouting');
    caption.textContent = 'Looking for your UTR…';
    setClip('searching', { loop: true });
    return {
      live: () => id === scanId,
      progress(p) { if (id === scanId && p > 0 && p < 1) caption.textContent = `Looking for your UTR… ${Math.round(p * 100)}%`; },
      // Wait out the rest of the kitty's full look, however quick the reading was.
      settle: async () => {
        await new Promise((r) => setTimeout(r, Math.max(0, SCOUT_MIN_MS - (Date.now() - started))));
        if (id === scanId) await finishLoop();
      },
      // state: 'found' (one UTR), 'many' (pick one) or 'lost' (none). Unsure ones get the big "?".
      end(state, text) {
        if (id !== scanId) return;
        const found = state === 'found';
        scoutEl.classList.add(found ? 'is-found' : 'is-lost');
        if (!found) scoutEl.classList.add('is-asking');
        setClip(found ? 'found' : 'puzzled');
        caption.textContent = text;
        setTimeout(() => {
          if (id !== scanId) return;
          scoutEl.classList.add('is-leaving');
          setTimeout(() => { if (id === scanId) hideScout(); }, 350);
        }, SCOUT_HOLD_MS);
      },
    };
  };

  if (uploaded) {
    statusEl.textContent = 'Your screenshot is already uploaded. Add the UTR and send.';
    empty.textContent = 'Screenshot uploaded. Tap to choose a different one.';
  }

  root.querySelector('[data-copy-upi]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(payment.upiId); toast('UPI ID copied.'); } catch { toast(payment.upiId); }
  });

  // App buttons: if nothing opened after a moment, say so. Coming back to the tab nudges to the form.
  let leftPage = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { leftPage = true; return; }
    if (leftPage && root.isConnected) {
      root.querySelector('[data-nudge]').hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  root.querySelectorAll('[data-app]').forEach((a) => a.addEventListener('click', () => {
    const before = leftPage;
    setTimeout(() => {
      if (!document.hidden && leftPage === before) root.querySelector('[data-app-miss]').hidden = false;
    }, 2500);
  }));

  utrInput.addEventListener('input', () => {
    typedByHand = true;
    ocrNote.hidden = true;
    ocrPick.hidden = true;
    utrInput.value = utrInput.value.replace(/[^\d\s-]/g, '');
  });

  const showCandidates = (found) => {
    const list = found.best.length ? found.best : found.all;
    if (!list.length) {
      ocrNote.hidden = false;
      ocrNote.textContent = 'We couldn’t read a UTR from the screenshot. Please type it in.';
      return;
    }
    if (typedByHand && utrInput.value) return; // never overwrite what they typed
    if (list.length === 1) {
      utrInput.value = list[0];
      ocrNote.hidden = false;
      ocrNote.textContent = 'We read this from your screenshot. Check it matches before sending.';
      return;
    }
    ocrNote.hidden = false;
    ocrNote.textContent = 'We found more than one number. Tap the UTR:';
    ocrPick.hidden = false;
    ocrPick.innerHTML = list.slice(0, 4).map((n) => html`<button class="link-copy" type="button" data-pick="${n}">${n}</button>`).join(' ');
    ocrPick.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      utrInput.value = b.dataset.pick;
      ocrPick.hidden = true;
      ocrNote.textContent = 'Check it matches your payment before sending.';
    }));
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Please choose a PNG, JPG or WebP screenshot.', { type: 'error' }); fileInput.value = ''; return; }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    empty.hidden = true;
    uploaded = null;
    writeStored(number, null);
    statusEl.textContent = 'Uploading…';
    uploading = uploadScreenshot(file, { number, token })
      .then((proof) => {
        uploaded = proof;
        writeStored(number, proof);
        statusEl.textContent = 'Screenshot uploaded.';
        return proof;
      })
      .catch((error) => {
        statusEl.textContent = '';
        hideScout();
        preview.hidden = true;
        empty.hidden = false;
        fileInput.value = '';
        toastError(error);
        return null;
      })
      .finally(() => { uploading = null; });

    // Optional: read the UTR off the screenshot, on this device. Manual entry works meanwhile.
    const scout = startScout();
    ocrNote.hidden = false;
    ocrNote.textContent = 'Reading the UTR from your screenshot… you can type it meanwhile.';
    const slow = setTimeout(() => { if (scout.live() && !utrInput.value) ocrNote.textContent = 'Still reading… typing it in is quicker.'; }, 12000);
    readScreenshot(file, (p) => scout.progress(p))
      .then((text) => findUtrCandidates(text))
      .catch(() => ({ best: [], all: [] }))
      .then(async (found) => {
        await scout.settle();
        if (!scout.live()) return;
        const list = found.best.length ? found.best : found.all;
        if (list.length === 1) scout.end('found', 'Found it!');
        else if (list.length) scout.end('many', 'Found a few. Pick yours.');
        else scout.end('lost', 'Couldn’t spot it. Please type it in.');
        showCandidates(found);
      })
      .finally(() => clearTimeout(slow));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const send = form.querySelector('[data-send]');
    const utr = cleanUtr(utrInput.value);
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    const fieldError = (input, message) => {
      const span = document.createElement('span');
      span.className = 'field-error';
      span.textContent = message;
      input.closest('.field').append(span);
      input.focus?.();
    };
    if (!validUtr(utr)) return fieldError(utrInput, 'The UTR is the 12-digit number in your payment details.');
    if (!uploaded && !uploading && !fileInput.files[0]) return fieldError(fileInput, 'Please add the screenshot of your payment.');
    send.disabled = true;
    send.classList.add('is-busy');
    try {
      const proof = uploaded || await uploading;
      if (!proof) throw new Error('Please add the screenshot again.');
      const result = await post(`/orders/${encodeURIComponent(number)}/payment-proof`, { t: token, kind: payment.kind, utr, proof });
      writeStored(number, null);
      onSubmitted?.(result.order);
    } catch (error) {
      if (error?.data?.field === 'screenshot') {
        writeStored(number, null);
        uploaded = null;
        statusEl.textContent = '';
        hideScout();
        preview.hidden = true;
        empty.hidden = false;
        empty.textContent = 'Tap to add the screenshot again';
        fileInput.value = '';
      }
      if (error?.data?.field === 'utr') fieldError(utrInput, error.message);
      else toastError(error);
    } finally {
      send.disabled = false;
      send.classList.remove('is-busy');
    }
  });
}

export function clearStoredProof(number) {
  writeStored(number, null);
}
