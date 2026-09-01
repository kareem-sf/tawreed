// Fails the build if THIRD_PARTY_NOTICES.md's declared versions drift from what's
// actually installed, so attribution can't silently go stale as dependencies update.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const installedVersion = (pkg) =>
  JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;

const tracked = {
  'tesseract.js': /`tesseract\.js` (\S+)/,
  'exceljs': /`exceljs` (\S+)/,
  'pdfjs-dist': /`pdfjs-dist` (\S+)/,
};

for (const [pkg, pattern] of Object.entries(tracked)) {
  const match = notices.match(pattern);
  if (!match) throw new Error(`THIRD_PARTY_NOTICES.md is missing an entry for ${pkg}`);
  const declared = match[1];
  const installed = installedVersion(pkg);
  if (declared !== installed) {
    throw new Error(
      `THIRD_PARTY_NOTICES.md declares ${pkg} ${declared} but node_modules has ${installed} — update the notice`,
    );
  }
}
