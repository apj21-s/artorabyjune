import { post } from './api.js';

// Shrinks photos in the browser so uploads are fast on mobile data.
export async function compressImage(file, { maxSize = 1800, quality = 0.84 } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That photo is too large (max 25 MB).');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('We couldn’t read that photo. Try another one.');
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return blob;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// purpose: references | reviews | memories | products | sketches | site
export async function uploadImage(file, purpose) {
  const blob = await compressImage(file);
  const sign = await post('/uploads/sign', { purpose });
  if (sign.provider === 'cloudinary') {
    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    fd.append('api_key', sign.apiKey);
    fd.append('timestamp', sign.timestamp);
    fd.append('signature', sign.signature);
    fd.append('folder', sign.folder);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('A photo didn’t upload. Please try again.');
    const json = await res.json();
    // Ask Cloudinary for an automatically optimised format.
    return json.secure_url.replace('/upload/', '/upload/f_auto,q_auto/');
  }
  const data = await blobToDataUrl(blob);
  const result = await post('/uploads/local', { purpose, data });
  return result.url;
}
