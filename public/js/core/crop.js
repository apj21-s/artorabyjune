// Photo cropper shown before an upload: drag to position, zoom, rotate, pick a shape.
// The frame is the same shape the photo is shown in on the site (product photos are 4:5,
// like the shop cards), so what you see here is what customers will see.
// Resolves with a JPEG Blob, the original file (if "Use as is"), or null when cancelled.

const SHAPES = {
  card: { label: 'Shop card (4:5)', ratio: 4 / 5 },
  square: { label: 'Square', ratio: 1 },
  wide: { label: 'Wide (4:3)', ratio: 4 / 3 },
  original: { label: 'Original shape', ratio: null },
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  });
  children.forEach((c) => node.append(c));
  return node;
}

async function loadBitmap(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) throw new Error('We couldn’t read that photo. Try another one.');
  return bmp;
}

// Turns a bitmap by 90° steps into a canvas we can draw from.
function rotated(source, quarterTurns) {
  const turns = ((quarterTurns % 4) + 4) % 4;
  const c = document.createElement('canvas');
  const swap = turns % 2 === 1;
  c.width = swap ? source.height : source.width;
  c.height = swap ? source.width : source.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return c;
}

export async function cropImage(file, { shape = 'card', title = 'Fit your photo', step = '' } = {}) {
  const bitmap = await loadBitmap(file);
  return new Promise((resolve) => {
    let turns = 0;
    let img = rotated(bitmap, 0);
    let shapeKey = SHAPES[shape] ? shape : 'card';
    let zoom = 1;
    let ox = 0; // image offset inside the frame, in frame pixels
    let oy = 0;
    let W = 0;
    let H = 0;

    const canvas = el('canvas', { class: 'crop-canvas', 'aria-label': 'Drag to position the photo' });
    const ctx = canvas.getContext('2d');
    const stage = el('div', { class: 'crop-stage' }, [canvas]);
    const zoomInput = el('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom' });
    const shapes = el('div', { class: 'crop-shapes', role: 'group', 'aria-label': 'Shape' },
      Object.entries(SHAPES).map(([k, s]) => el('button', { type: 'button', 'data-shape': k, class: k === shapeKey ? 'is-on' : '', text: s.label })));
    const rotateBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Rotate ↻' });
    const resetBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Reset' });
    const useBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Use this photo' });
    const asIsBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Use as is' });
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-link', text: 'Cancel' });
    const panel = el('div', { class: 'crop-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'crop-head' }, [el('h2', { text: title }), step ? el('span', { class: 'crop-step', text: step }) : '']),
      el('p', { class: 'crop-hint', text: 'Drag the photo to position it and use the slider to zoom. The frame shows exactly how it will look on the website.' }),
      stage,
      el('div', { class: 'crop-tools' }, [el('label', { class: 'crop-zoom' }, [el('span', { text: 'Zoom' }), zoomInput]), rotateBtn, resetBtn]),
      shapes,
      el('div', { class: 'crop-actions' }, [useBtn, asIsBtn, cancelBtn]),
    ]);
    const overlay = el('div', { class: 'crop-overlay' }, [panel]);
    document.body.append(overlay);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const ratio = () => SHAPES[shapeKey].ratio || img.width / img.height;
    const baseScale = () => Math.max(W / img.width, H / img.height); // "cover": no empty edges
    const scale = () => baseScale() * zoom;
    const clamp = () => {
      const s = scale();
      const minX = W - img.width * s;
      const minY = H - img.height * s;
      ox = Math.min(0, Math.max(minX, ox));
      oy = Math.min(0, Math.max(minY, oy));
    };
    const center = () => {
      const s = scale();
      ox = (W - img.width * s) / 2;
      oy = (H - img.height * s) / 2;
    };
    const layout = () => {
      const maxW = Math.min((stage.clientWidth || 380) - 20, 520); // minus the stage padding
      const maxH = Math.max(220, Math.min(window.innerHeight * 0.5, 520));
      W = maxW;
      H = W / ratio();
      if (H > maxH) { H = maxH; W = H * ratio(); }
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      clamp();
      ctx.clearRect(0, 0, W, H);
      const s = scale();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, ox, oy, img.width * s, img.height * s);
      // light rule-of-thirds guide
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      [1, 2].forEach((i) => {
        ctx.beginPath(); ctx.moveTo((W * i) / 3, 0); ctx.lineTo((W * i) / 3, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (H * i) / 3); ctx.lineTo(W, (H * i) / 3); ctx.stroke();
      });
    };
    const reset = () => { zoom = 1; zoomInput.value = '1'; layout(); center(); draw(); };

    // Zoom around a point so the spot under the finger stays put.
    const zoomTo = (next, cx = W / 2, cy = H / 2) => {
      const before = scale();
      zoom = Math.min(4, Math.max(1, next));
      const after = scale();
      ox = cx - ((cx - ox) * after) / before;
      oy = cy - ((cy - oy) * after) / before;
      zoomInput.value = String(zoom);
      draw();
    };

    // Dragging and pinching
    const pointers = new Map();
    let pinchStart = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const rect = canvas.getBoundingClientRect();
        zoomTo(pinchStart.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      } else if (pointers.size === 1) {
        ox += e.clientX - prev.x;
        oy += e.clientY - prev.y;
        draw();
      }
    });
    const lift = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      const stepPx = e.shiftKey ? 20 : 6;
      if (e.key === 'ArrowLeft') ox += stepPx; else if (e.key === 'ArrowRight') ox -= stepPx;
      else if (e.key === 'ArrowUp') oy += stepPx; else if (e.key === 'ArrowDown') oy -= stepPx;
      else if (e.key === '+' || e.key === '=') return zoomTo(zoom * 1.1);
      else if (e.key === '-') return zoomTo(zoom / 1.1);
      else return;
      e.preventDefault();
      draw();
    });
    canvas.tabIndex = 0;

    zoomInput.addEventListener('input', () => zoomTo(Number(zoomInput.value)));
    rotateBtn.addEventListener('click', () => { turns += 1; img = rotated(bitmap, turns); reset(); });
    resetBtn.addEventListener('click', () => { turns = 0; img = rotated(bitmap, 0); reset(); });
    shapes.addEventListener('click', (e) => {
      const b = e.target.closest('[data-shape]');
      if (!b) return;
      shapeKey = b.dataset.shape;
      shapes.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
      reset();
    });

    const finish = (value) => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onEsc, true);
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      bitmap.close?.();
      resolve(value);
    };
    useBtn.addEventListener('click', () => {
      // Export the framed area at full photo resolution (capped; the upload step compresses further).
      const s = scale();
      const sx = -ox / s;
      const sy = -oy / s;
      const sw = W / s;
      const sh = H / s;
      const outW = Math.round(Math.min(sw, 1800));
      const outH = Math.round(outW * (H / W));
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const octx = out.getContext('2d');
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      out.toBlob((blob) => finish(blob), 'image/jpeg', 0.9);
    });
    asIsBtn.addEventListener('click', () => finish(file));
    cancelBtn.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onEsc, true);
    const onResize = () => { const keep = zoom; layout(); zoom = keep; draw(); };
    window.addEventListener('resize', onResize);

    requestAnimationFrame(() => { reset(); canvas.focus(); });
  });
}
