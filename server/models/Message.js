const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  topic: String,
  message: String,
  handled: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);
