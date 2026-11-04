import { read, write } from './store.js';

const KEY = 'artora.cart.v1';
const listeners = new Set();

export function getCart() {
  const items = read(KEY, []);
  return Array.isArray(items) ? items.filter((i) => i && i.productId && i.qty > 0) : [];
}

function save(items) {
  write(KEY, items);
  listeners.forEach((fn) => fn(items));
}

export function onCartChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Snapshot fields are display-only; the server re-prices everything at checkout.
export function addToCart(product, qty = 1) {
  const items = getCart();
  const existing = items.find((i) => i.productId === product.id);
  if (existing) existing.qty = Math.min(10, existing.qty + qty);
  else items.push({ productId: product.id, qty, title: product.title, slug: product.slug, price: product.price, image: product.images?.[0] || '' });
  save(items);
}

export function setQty(productId, qty) {
  const items = getCart()
    .map((i) => (i.productId === productId ? { ...i, qty: Math.max(0, Math.min(10, qty)) } : i))
    .filter((i) => i.qty > 0);
  save(items);
}

export const removeFromCart = (productId) => setQty(productId, 0);
export const clearCart = () => save([]);
export const cartCount = () => getCart().reduce((s, i) => s + i.qty, 0);
export const cartSubtotal = () => getCart().reduce((s, i) => s + i.price * i.qty, 0);

// Keep tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) listeners.forEach((fn) => fn(getCart()));
});
