#!/usr/bin/env node
// Cross-checks the Tauri command surface: every command registered in main.rs must be
// reachable from bridge.ts, and every command bridge.ts invokes must be registered.
//
// The IPC boundary is hand-mirrored (no ts-rs/specta codegen yet) and several invoke
// names are built from template literals, so neither compiler sees a rename. Without
// this gate a dropped or renamed command only fails at runtime, in front of a user.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');
const bridgeTs = fs.readFileSync(path.join(root, 'src/bridge.ts'), 'utf8');

const handlerBlock = mainRs.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handlerBlock) {
  console.error('verify-commands: could not find generate_handler![...] in main.rs');
  process.exit(1);
}

const registered = new Set(
  handlerBlock[1]
    .split(',')
    .map((entry) => entry.replace(/\/\/.*$/gm, '').trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^\w+::/, '')),
);

// Literal invocations: invoke('name') / invoke<T>('name').
const invoked = new Set();
for (const match of bridgeTs.matchAll(/invoke\w*\s*(?:<[^()]*>)?\s*\(\s*'([a-z0-9_]+)'/g)) {
  invoked.add(match[1]);
}

// Template invocations: invoke(`${id}_test`) expanded over the provider ids the
// factory is instantiated with, so the generated names are checked too.
const providerIds = [...bridgeTs.matchAll(/makeNamedProviderBridge\('([a-z0-9]+)'\)/g)]
  .map((match) => match[1]);
for (const match of bridgeTs.matchAll(/invoke\w*\s*(?:<[^()]*>)?\s*\(\s*`\$\{id\}([a-z0-9_]+)`/g)) {
  for (const id of providerIds) invoked.add(`${id}${match[1]}`);
}
for (const match of bridgeTs.matchAll(/invoke\w*\s*(?:<[^()]*>)?\s*\(\s*`([a-z0-9_]+)\$\{id\}([a-z0-9_]*)`/g)) {
  for (const id of providerIds) invoked.add(`${match[1]}${id}${match[2]}`);
}

// Indirect invocations: a command name passed through a local helper, e.g.
// providerTest('anthropic_test') or invokeAi('gemini_complete', ...).
for (const match of bridgeTs.matchAll(/\b[A-Za-z]\w*\(\s*'([a-z0-9]+_[a-z0-9_]+)'/g)) {
  if (registered.has(match[1])) invoked.add(match[1]);
}

const problems = [];
for (const name of [...registered].sort()) {
  if (!invoked.has(name)) {
    problems.push(`- ${name} is registered in main.rs but never invoked from bridge.ts`);
  }
}
for (const name of [...invoked].sort()) {
  if (!registered.has(name)) {
    problems.push(`- ${name} is invoked from bridge.ts but not registered in main.rs`);
  }
}

if (problems.length > 0) {
  console.error('Tauri command verification failed:');
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

console.log(`Verified ${registered.size} Tauri commands across main.rs and bridge.ts.`);
