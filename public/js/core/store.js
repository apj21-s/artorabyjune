// localStorage can be missing or throw (private mode, blocked storage). Never let that break the page.
export function read(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function remove(key) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}
