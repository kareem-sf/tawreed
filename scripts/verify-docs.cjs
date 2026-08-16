const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { dirname, extname, join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const documentationRoots = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs'];
const errors = [];

function collect(path) {
  const absolute = resolve(root, path);
  if (extname(absolute)) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) return collect(relative(root, child));
    return entry.name.endsWith('.md') ? [child] : [];
  });
}

for (const file of documentationRoots.flatMap(collect)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (!target || target.startsWith('#') || /^[a-z]+:\/\//i.test(target) || target.startsWith('mailto:')) {
      continue;
    }
    const withoutAnchor = target.split('#')[0];
    if (!withoutAnchor) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(withoutAnchor));
    if (!existsSync(resolved)) {
      errors.push(`${relative(root, file)} -> ${target}`);
    }
  }
}

if (errors.length) {
  console.error('Documentation verification failed; broken local links:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Verified local documentation links.');
