const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
  label: { type: String, default: 'Home' },
  name: String,
  phone: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  pincode: String,
}, { _id: true });

const MemorySchema = new mongoose.Schema({
  title: String,
  note: String,
  image: String,
  createdAt: { type: Date, default: Date.now },
});

const UserSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  email: { type: String, unique: true, index: true, lowercase: true, trim: true },
  passwordHash: String,
  googleId: String,
  role: { type: String, default: 'customer', enum: ['customer', 'admin'] },
  phone: String,
  profile: {
    displayName: String,
    pronouns: String,
    bio: String,
  },
  addresses: { type: [AddressSchema], default: [] },
  memories: { type: [MemorySchema], default: [] },
  savedProducts: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  resetTokenHash: String,
  resetTokenExpires: Date,
  lastLoginAt: Date,
}, { timestamps: true });

UserSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    phone: this.phone || '',
    profile: this.profile || {},
  };
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
