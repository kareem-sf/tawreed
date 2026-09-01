#!/usr/bin/env node
// Fails if the committed TypeScript bindings differ from what the Rust structs generate.
//
// src/bridge-types/ is produced by ts-rs (`cargo test export_bindings`) and is what
// bridge.ts imports. Without this gate a field could be added, renamed, or retyped in
// Rust and the webview would keep compiling against a stale shape — exactly the drift
// ts-rs was introduced to close.
'use strict';

const { spawnSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const bindings = join(root, 'src', 'bridge-types');

function snapshot() {
  return readdirSync(bindings)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => `${name}\n${readFileSync(join(bindings, name), 'utf8')}`)
    .join('\n');
}

const before = snapshot();

const generated = spawnSync(
  process.platform === 'win32' ? 'cargo.exe' : 'cargo',
  ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', 'export_bindings'],
  { cwd: root, encoding: 'utf8', timeout: 600_000 },
);

if (generated.status !== 0) {
  console.error('Could not regenerate TypeScript bindings from the Rust structs.');
  console.error(generated.stderr || generated.stdout);
  process.exit(1);
}

if (snapshot() !== before) {
  console.error(
    'Committed bindings in src/bridge-types/ are stale.\n'
    + 'A Rust struct crossing the Tauri boundary changed without its binding being '
    + 'regenerated. Run:\n\n'
    + '  cargo test --manifest-path src-tauri/Cargo.toml export_bindings\n\n'
    + 'then commit the updated files in src/bridge-types/.',
  );
  process.exit(1);
}

console.log('Verified TypeScript bindings match the Rust structs.');
