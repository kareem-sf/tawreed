import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = resolve(repositoryRoot, 'agent-kernel', 'dist', 'index.mjs');

await mkdir(dirname(outputFile), { recursive: true });
await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ['agent-kernel/src/index.ts'],
  outfile: outputFile,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  packages: 'external',
  charset: 'utf8',
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'silent',
});
