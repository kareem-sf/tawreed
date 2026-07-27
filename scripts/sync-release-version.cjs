const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => {
  const target = path.join(root, file);
  if (fs.readFileSync(target, 'utf8') !== content) fs.writeFileSync(target, content);
};
const json = (file) => JSON.parse(read(file).replace(/^\uFEFF/, ''));
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

const packageJson = json('package.json');
const version = packageJson.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json contains an invalid semantic version: ${String(version)}`);
}

const packageLock = json('package-lock.json');
packageLock.version = version;
if (!packageLock.packages?.['']) throw new Error('package-lock.json has no root package entry');
packageLock.packages[''].version = version;
write('package-lock.json', jsonText(packageLock));

const tauri = json('src-tauri/tauri.conf.json');
tauri.version = version;
write('src-tauri/tauri.conf.json', jsonText(tauri));

const cargoToml = read('src-tauri/Cargo.toml');
const packageSection = cargoToml.match(/^\[package\]\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m);
if (!packageSection) throw new Error('Cargo.toml has no [package] section');
const updatedSection = packageSection[0].replace(
  /^(version\s*=\s*")[^"]+(")/m,
  `$1${version}$2`,
);
if (updatedSection === packageSection[0] && !packageSection[0].includes(`version = "${version}"`)) {
  throw new Error('Cargo.toml [package] section has no version field');
}
write('src-tauri/Cargo.toml', cargoToml.replace(packageSection[0], updatedSection));

const cargoLock = read('src-tauri/Cargo.lock');
const lockPattern = /(\[\[package\]\]\r?\nname = "tawreed"\r?\nversion = ")[^"]+(")/;
if (!lockPattern.test(cargoLock)) throw new Error('Cargo.lock has no tawreed package entry');
write('src-tauri/Cargo.lock', cargoLock.replace(lockPattern, `$1${version}$2`));

console.log(`Synchronized Tawreed desktop manifests to ${version}.`);
