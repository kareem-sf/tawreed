const { readFileSync, readdirSync, statSync } = require('node:fs');
const { dirname, extname, join, normalize, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const sourceRoots = ['src', 'engine', 'shared', 'tests'];
const sourceExtensions = new Set(['.ts', '.tsx']);
const errors = [];

function walk(directory) {
  const absolute = resolve(root, directory);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) return walk(relative(root, path));
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

const files = sourceRoots.flatMap(walk).filter((path) => !path.endsWith('.d.ts'));
const fileSet = new Set(files.map((path) => normalize(path)));

function projectPath(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function resolveModule(importer, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/')
    ? resolve(root, specifier.slice(2))
    : resolve(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.map(normalize).find((candidate) => fileSet.has(candidate)) ?? null;
}

function importsFor(path) {
  const source = readFileSync(path, 'utf8');
  const specifiers = new Set();
  const patterns = [
    /(?:from\s+|import\s*\()(['"])([^'"]+)\1/g,
    /import\s+(['"])([^'"]+)\1/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[2]);
  }
  return [...specifiers]
    .map((specifier) => resolveModule(path, specifier))
    .filter(Boolean);
}

const graph = new Map(files.map((path) => [normalize(path), importsFor(path)]));

function detectCycles() {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(path) {
    if (visiting.has(path)) {
      const start = stack.indexOf(path);
      errors.push(`Import cycle: ${[...stack.slice(start), path].map(projectPath).join(' -> ')}`);
      return;
    }
    if (visited.has(path)) return;
    visiting.add(path);
    stack.push(path);
    for (const dependency of graph.get(path) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(path);
    visited.add(path);
  }

  for (const path of graph.keys()) visit(path);
}

function detectUnreachable() {
  const entries = files.filter((path) => projectPath(path).startsWith('tests/'));
  for (const entry of [
    'src/main.tsx',
    'src/workers/boq.worker.ts',
  ]) {
    entries.push(resolve(root, entry));
  }
  const reachable = new Set();
  const pending = entries.map(normalize);
  while (pending.length) {
    const path = pending.pop();
    if (!path || reachable.has(path)) continue;
    reachable.add(path);
    pending.push(...(graph.get(path) ?? []));
  }

  for (const path of files) {
    const name = projectPath(path);
    if (name.startsWith('tests/') || reachable.has(normalize(path))) continue;
    errors.push(`Unreachable source file: ${name}`);
  }
}

function enforceBoundaries() {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const dependency of ['@base-ui/react', '@number-flow/react']) {
    if (dependency in dependencies) errors.push(`Forbidden duplicate/unused UI dependency: ${dependency}`);
  }

  const forbiddenPaths = [
    'components.json',
    'src/components/charts',
    'src/components/ui/animated-list.tsx',
    'src/components/ui/animated-shiny-text.tsx',
    'src/components/ui/shimmer-button.tsx',
  ];
  for (const path of forbiddenPaths) {
    try {
      statSync(resolve(root, path));
      errors.push(`Removed legacy path was reintroduced: ${path}`);
    } catch {
      // Expected: the legacy path does not exist.
    }
  }

  for (const path of files.filter((candidate) => projectPath(candidate).startsWith('src/'))) {
    const name = projectPath(path);
    const source = readFileSync(path, 'utf8');
    if (
      source.includes("from '@tauri-apps/api")
      && name !== 'src/bridge.ts'
      && !name.startsWith('src/platform/')
    ) {
      errors.push(`Direct Tauri API import outside desktop boundary: ${name}`);
    }
  }

  const budgets = new Map([
    ['src/App.tsx', 180],
    ['src/bridge.ts', 350],
    ['src/features/workflow/useBoqWorkflow.ts', 500],
    ['src/features/settings/ProviderSetup.tsx', 300],
    ['src/features/settings/useProviderSetup.ts', 250],
  ]);
  for (const path of files) {
    const name = projectPath(path);
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).length;
    const budget = budgets.get(name) ?? (name.startsWith('src/') ? 500 : null);
    if (budget !== null && budget !== undefined && lines > budget) {
      errors.push(`Module-size budget exceeded: ${name} has ${lines} lines (limit ${budget})`);
    }
  }
}

detectCycles();
detectUnreachable();
enforceBoundaries();

if (errors.length) {
  console.error('Architecture verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Verified architecture boundaries, reachability, cycles, and module budgets across ${files.length} TypeScript files.`);
