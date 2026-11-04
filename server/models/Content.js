const mongoose = require('mongoose');

const ContentSchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });

module.exports = mongoose.models.Content || mongoose.model('Content', ContentSchema);
