const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.resolve(root, process.argv[2] || 'release/LICENSES.txt');
const sections = [];
const seen = new Set();

const addSection = (id, metadata, files) => {
  if (seen.has(id)) return;
  seen.add(id);
  sections.push(`\n===== ${id} =====\n${metadata.trim()}\n`);
  const uniqueFiles = [...new Set(files)].filter((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile());
  if (uniqueFiles.length === 0) {
    sections.push('No standalone license file was present in the locked package. See the declared license above.\n');
    return;
  }
  for (const file of uniqueFiles) {
    if (fs.statSync(file).size > 512 * 1024) throw new Error(`License file is unexpectedly large: ${file}`);
    sections.push(`\n--- ${path.basename(file)} ---\n${fs.readFileSync(file, 'utf8').trim()}\n`);
  }
};

const conventionalLicenses = (directory, explicit) => {
  const files = explicit ? [explicit] : [];
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return files;
  for (const entry of fs.readdirSync(directory)) {
    if (/^(licen[cs]e|unlicense|copying|notices?)([-_.].+)?$/i.test(entry)) files.push(path.join(directory, entry));
  }
  return files;
};

addSection('Tawreed', 'License: MIT', [path.join(root, 'LICENSE')]);
addSection('Apache License 2.0 dependencies and vendored assets', 'License: Apache-2.0', [
  path.join(root, 'third_party/licenses/APACHE-2.0.txt'),
]);

const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const [lockPath, pkg] of Object.entries(packageLock.packages || {})) {
  if (!lockPath.startsWith('node_modules/') || pkg.dev === true) continue;
  const directory = path.join(root, lockPath);
  const packageFile = path.join(directory, 'package.json');
  if (!fs.statSync(packageFile, { throwIfNoEntry: false })?.isFile()) continue;
  const installed = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const id = `npm ${installed.name}@${installed.version}`;
  const repository = typeof installed.repository === 'string'
    ? installed.repository
    : installed.repository?.url;
  const metadata = `Declared license: ${installed.license || pkg.license || 'not specified'}\nRepository: ${repository || 'not specified'}`;
  addSection(id, metadata, conventionalLicenses(directory));
}

const cargo = JSON.parse(childProcess.execFileSync(
  'cargo',
  ['metadata', '--format-version', '1', '--locked', '--manifest-path', 'src-tauri/Cargo.toml'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
));
const resolvedCargoPackages = new Set(cargo.resolve?.nodes.map((node) => node.id) || []);
for (const pkg of cargo.packages) {
  if (!resolvedCargoPackages.has(pkg.id)) continue;
  if (pkg.name === 'tawreed') continue;
  const directory = path.dirname(pkg.manifest_path);
  const explicit = pkg.license_file ? path.resolve(directory, pkg.license_file) : null;
  const metadata = `Declared license: ${pkg.license || 'not specified'}\nRepository: ${pkg.repository || pkg.source || 'not specified'}`;
  addSection(`Cargo ${pkg.name}@${pkg.version}`, metadata, conventionalLicenses(directory, explicit));
}

const text = sections.join('\n').replace(/\r\n/g, '\n').trimStart();
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, text.endsWith('\n') ? text : `${text}\n`);
console.log(`Generated ${path.relative(root, output)} with ${seen.size} package/license sections (${crypto.createHash('sha256').update(text).digest('hex')}).`);
