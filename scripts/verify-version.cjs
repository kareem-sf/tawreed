const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const packageJson = json('package.json');
const packageLock = json('package-lock.json');
const tauri = json('src-tauri/tauri.conf.json');
const cargoToml = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
const cargoLock = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLockVersion = cargoLock.match(/\[\[package\]\]\r?\nname = "tawreed"\r?\nversion = "([^"]+)"/)?.[1];
const versions = {
  'package.json': packageJson.version,
  'package-lock.json top level': packageLock.version,
  'package-lock.json': packageLock.packages?.['']?.version,
  'tauri.conf.json': tauri.version,
  'Cargo.toml': cargoVersion,
  'Cargo.lock': cargoLockVersion,
};
const expected = packageJson.version;
for (const [source, version] of Object.entries(versions)) {
  if (version !== expected) throw new Error(`${source} version ${version ?? '(missing)'} does not match ${expected}`);
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${expected}]`)) {
  throw new Error(`CHANGELOG.md has no "## [${expected}]" heading for the current version`);
}

const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : process.argv[2];
if (tag && tag !== `v${expected}`) throw new Error(`Tag ${tag} does not match v${expected}`);
console.log(`Verified Tawreed version ${expected}${tag ? ` against ${tag}` : ''}.`);
