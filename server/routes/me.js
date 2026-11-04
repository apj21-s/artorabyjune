const express = require('express');
const { Order, Product } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { validate, z, str, phone, url } = require('../middleware/validate');
const { customerView } = require('../lib/orders');

const router = express.Router();
router.use(requireAuth);

router.get('/orders', async (req, res) => {
  const orders = await Order.find({ $or: [{ userId: req.user._id }, { email: req.user.email }] }).sort({ createdAt: -1 }).limit(50);
  res.json({ items: orders.map((o) => ({ ...customerView(o), token: o.accessToken })) });
});

// Saved totes (wishlist). Guests keep theirs in the browser; the list merges in when they sign in.
async function savedProducts(ids) {
  const products = await Product.find({ _id: { $in: ids }, status: 'live' });
  return ids.map((id) => products.find((p) => String(p._id) === String(id))).filter(Boolean).map((p) => p.toPublic());
}
router.get('/saved', async (req, res) => res.json({ ids: req.user.savedProducts.map(String), items: await savedProducts(req.user.savedProducts) }));
router.put('/saved', validate(z.object({ ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100) })), async (req, res) => {
  req.user.savedProducts = [...new Set(req.body.ids)];
  await req.user.save();
  res.json({ ids: req.user.savedProducts.map(String), items: await savedProducts(req.user.savedProducts) });
});

router.get('/profile', (req, res) => {
  res.json({ user: req.user.toPublic(), addresses: req.user.addresses, memories: req.user.memories });
});

router.put('/profile', validate(z.object({
  name: str(80).min(1, 'Please add your name.'),
  phone: phone().optional().default(''),
  pronouns: str(60).optional().default(''),
  bio: str(400).optional().default(''),
})), async (req, res) => {
  const { name, phone: ph, pronouns, bio } = req.body;
  req.user.name = name;
  req.user.phone = ph;
  req.user.profile = { displayName: name, pronouns, bio };
  await req.user.save();
  res.json({ user: req.user.toPublic() });
});

const addressSchema = z.object({
  label: str(30).optional().default('Home'),
  name: str(80).min(1, 'Please add a name.'),
  phone: phone().min(10, 'Please add a phone number.'),
  line1: str(200).min(3, 'Please add the address.'),
  line2: str(200).optional().default(''),
  city: str(80).min(2, 'Please add the city.'),
  state: str(80).min(2, 'Please add the state.'),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Please enter a 6-digit pincode.'),
});

router.put('/addresses', validate(z.object({ items: z.array(addressSchema).max(5) })), async (req, res) => {
  req.user.addresses = req.body.items;
  await req.user.save();
  res.json({ items: req.user.addresses });
});

router.post('/memories', validate(z.object({
  title: str(120).min(1, 'Give the memory a short title.'),
  note: str(2000).optional().default(''),
  image: url().optional().default(''),
})), async (req, res) => {
  req.user.memories.unshift(req.body);
  req.user.memories = req.user.memories.slice(0, 30);
  await req.user.save();
  res.status(201).json({ items: req.user.memories });
});

router.delete('/memories/:id', async (req, res) => {
  req.user.memories = req.user.memories.filter((m) => String(m._id) !== req.params.id);
  await req.user.save();
  res.json({ items: req.user.memories });
});

module.exports = router;
