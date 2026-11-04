// Usage: npm run create-admin -- you@example.com "A strong password" "Your Name"
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { User, Content } = require('../models');

(async () => {
  const [email, password, name = 'June'] = process.argv.slice(2);
  if (!email || !password || password.length < 8) {
    console.error('Usage: npm run create-admin -- you@example.com "password (8+ characters)" "Your Name"');
    process.exit(1);
  }
  await mongoose.connect(config.mongoUri);
  const address = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  await User.updateOne(
    { email: address },
    { $set: { passwordHash, role: 'admin' }, $setOnInsert: { email: address, name, profile: { displayName: name } } },
    { upsert: true },
  );
  await Content.updateOne({ key: 'security' }, { $addToSet: { 'data.approvedAdminEmails': address }, $setOnInsert: { key: 'security' } }, { upsert: true });
  console.log(`Admin ready: ${address}. Sign in at ${config.appUrl}/login`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
