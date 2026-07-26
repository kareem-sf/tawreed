const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const requireFile = (relative) => {
  const file = path.join(root, relative);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Required vendor asset is missing: ${relative}`);
  }
  return file;
};
const assertSame = (left, right) => {
  if (sha256(requireFile(left)) !== sha256(requireFile(right))) {
    throw new Error(`Vendor asset differs from its locked package: ${left}`);
  }
};

const languageModels = {
  'public/ocr/lang/eng.traineddata.gz': '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b',
  'public/ocr/lang/ara.traineddata.gz': 'cfdec92af6c72289984b03dfe5e03d25f7fee591733081aa6f40761f3f5884cf',
};
for (const [file, expected] of Object.entries(languageModels)) {
  if (sha256(requireFile(file)) !== expected) throw new Error(`Unexpected language model checksum: ${file}`);
}

assertSame('public/ocr/worker.min.js', 'node_modules/tesseract.js/dist/worker.min.js');
for (const entry of fs.readdirSync(path.join(root, 'public/ocr/core'))) {
  assertSame(`public/ocr/core/${entry}`, `node_modules/tesseract.js-core/${entry}`);
}

// engine/pdf-ingest.ts loads these runtime paths directly; fail if any are absent.
const requireNonEmptyDirectory = (relative) => {
  const directory = path.join(root, relative);
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory() || fs.readdirSync(directory).length === 0) {
    throw new Error(`Required vendor asset directory is missing or empty: ${relative}`);
  }
};
requireFile('public/ocr/worker.min.js');
requireNonEmptyDirectory('public/ocr/lang');
requireNonEmptyDirectory('public/ocr/core');
requireNonEmptyDirectory('public/pdfjs/wasm');
requireNonEmptyDirectory('public/pdfjs/standard_fonts');
requireNonEmptyDirectory('public/pdfjs/cmaps');

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(absolute) : [absolute];
});
for (const file of walk(path.join(root, 'public/pdfjs'))) {
  const relative = path.relative(path.join(root, 'public/pdfjs'), file);
  assertSame(`public/pdfjs/${relative}`, `node_modules/pdfjs-dist/${relative}`);
}

const dist = path.join(root, 'dist');
if (fs.statSync(dist, { throwIfNoEntry: false })?.isDirectory()) {
  for (const file of walk(path.join(root, 'public'))) {
    const relative = path.relative(path.join(root, 'public'), file);
    assertSame(`public/${relative}`, `dist/${relative}`);
  }
}

console.log('Verified bundled OCR and PDF.js assets.');
