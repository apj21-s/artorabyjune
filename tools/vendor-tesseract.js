// Copies the on-device text reader (Tesseract.js) into public/vendor/tesseract so the
// payment page can read the UTR from a screenshot without loading any third-party script.
// Runs after `npm install` (postinstall) and as the Vercel build step. The copied files are
// not committed (see .gitignore); they always match the pinned versions in package.json.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'vendor', 'tesseract');

function resolveDir(pkg) {
  try {
    return path.dirname(require.resolve(`${pkg}/package.json`, { paths: [root] }));
  } catch {
    return null;
  }
}

const js = resolveDir('tesseract.js');
const core = resolveDir('tesseract.js-core');
const eng = resolveDir('@tesseract.js-data/eng');
if (!js || !core || !eng) {
  console.warn('[vendor-tesseract] packages not installed; skipping (screenshot reading will be unavailable).');
  process.exit(0);
}

const files = [
  [path.join(js, 'dist', 'tesseract.min.js'), 'tesseract.min.js'],
  [path.join(js, 'dist', 'worker.min.js'), 'worker.min.js'],
  // LSTM-only cores: the worker picks the fastest one the phone supports.
  [path.join(core, 'tesseract-core-lstm.wasm.js'), 'core/tesseract-core-lstm.wasm.js'],
  [path.join(core, 'tesseract-core-simd-lstm.wasm.js'), 'core/tesseract-core-simd-lstm.wasm.js'],
  [path.join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  [path.join(eng, '4.0.0_best_int', 'eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
];

for (const [from, to] of files) {
  const dest = path.join(out, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}
console.log(`[vendor-tesseract] copied ${files.length} files to public/vendor/tesseract`);
