const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

// Atomic, so two orders placed at the same moment never share a number.
async function nextSequence(name) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return doc.seq;
}

module.exports = { Counter, nextSequence };
