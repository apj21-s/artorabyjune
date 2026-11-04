const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  summary: String,
  description: String,
  price: { type: Number, required: true, min: 0 },
  compareAt: { type: Number, min: 0 },
  images: { type: [String], default: [] },
  stock: { type: Number, default: 1, min: 0 },
  status: { type: String, enum: ['draft', 'live'], default: 'live', index: true },
  tags: { type: [String], default: [] },
  colour: String,
  featured: { type: Boolean, default: false },
  badge: String,
  details: {
    size: String,
    material: String,
    care: String,
  },
  sortOrder: { type: Number, default: 0 },
  // 'giftcard' products are digital store credit: no shipping, a code is emailed on payment.
  kind: { type: String, enum: ['tote', 'giftcard'], default: 'tote' },
  // Bundle: when this and `bundleWith` are both in the bag, `bundleDiscount` (₹) comes off per pair.
  bundleWith: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  bundleDiscount: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

ProductSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    title: this.title,
    slug: this.slug,
    summary: this.summary || '',
    description: this.description || '',
    price: this.price,
    compareAt: this.compareAt || null,
    images: this.images,
    inStock: this.stock > 0,
    lowStock: this.stock > 0 && this.stock <= 2,
    tags: this.tags,
    colour: this.colour || '',
    featured: this.featured,
    badge: this.badge || '',
    details: this.details || {},
    kind: this.kind || 'tote',
    bundleWith: this.bundleWith ? String(this.bundleWith) : null,
    bundleDiscount: this.bundleDiscount || 0,
  };
};

module.exports = mongoose.models.Product || mongoose.model('Product', ProductSchema);
