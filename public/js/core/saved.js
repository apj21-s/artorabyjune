// Saved totes (wishlist). Kept in the browser for everyone; merged into the account when signed in.
import { read, write } from './store.js';
import { get, put } from './api.js';

const KEY = 'artora.saved.v1';
const listeners = new Set();
let signedIn = false;

export const getSaved = () => (Array.isArray(read(KEY, [])) ? read(KEY, []) : []);
export const isSaved = (id) => getSaved().includes(String(id));
export const onSavedChange = (fn) => listeners.add(fn);

function set(ids) {
  write(KEY, ids);
  listeners.forEach((fn) => fn(ids));
}

export function toggleSaved(id) {
  const key = String(id);
  const ids = getSaved();
  const next = ids.includes(key) ? ids.filter((i) => i !== key) : [key, ...ids].slice(0, 100);
  set(next);
  if (signedIn) put('/me/saved', { ids: next }).catch(() => {});
  return next.includes(key);
}

// On sign-in: union of this browser's list and the account's list, saved both ways.
export async function syncSaved() {
  try {
    const remote = await get('/me/saved');
    signedIn = true;
    const merged = [...new Set([...getSaved(), ...remote.ids])];
    set(merged);
    if (merged.length !== remote.ids.length) await put('/me/saved', { ids: merged });
  } catch { signedIn = false; }
}
