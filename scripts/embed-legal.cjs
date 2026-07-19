const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'dist', 'legal');
fs.mkdirSync(destination, { recursive: true });

for (const [source, name] of [
  ['LICENSE', 'TAWREED-MIT.txt'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt'],
  ['third_party/licenses/APACHE-2.0.txt', 'APACHE-2.0.txt'],
]) {
  fs.copyFileSync(path.join(root, source), path.join(destination, name));
}

console.log('Embedded Tawreed and third-party legal notices.');
