#!/usr/bin/env node
// Runs the live-provider accuracy evaluation. Sets the environment cross-platform so the
// live test un-skips, then hands off to vitest. Usage:
//   npm run eval -- --provider anthropic --model claude-sonnet-5
import { spawn } from 'node:child_process';

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

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', 'tests/eval/live.test.ts', '--reporter', 'basic'],
  { env, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
