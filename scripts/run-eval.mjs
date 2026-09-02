#!/usr/bin/env node
// Runs the live-provider accuracy evaluation. Sets the environment cross-platform so the
// live test un-skips, then hands off to vitest. Usage:
//   npm run eval -- --provider anthropic --model claude-sonnet-5
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const env = { ...process.env, TAWREED_EVAL_LIVE: '1' };
const provider = flag('provider');
const model = flag('model');
if (provider) env.TAWREED_EVAL_PROVIDER = provider;
if (model) env.TAWREED_EVAL_MODEL = model;

// Run vitest's JS entry with this Node binary rather than the `vitest` shim: spawning a
// .cmd without a shell is EINVAL on Windows, and using a shell to work around that would
// put these arguments through cmd.exe parsing.
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const child = spawn(
  process.execPath,
  [vitest, 'run', 'tests/eval/live.test.ts'],
  { env, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
