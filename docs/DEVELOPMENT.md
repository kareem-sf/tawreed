# Development

## Supported toolchain

- Node.js 24 (`.node-version`)
- npm lockfile installation (`npm ci`)
- Rust toolchain configured by CI and `src-tauri/rust-toolchain.toml` when present
- Tauri 2 platform build dependencies

Do not use `npm install` to casually rewrite the lockfile. Dependency changes
must be intentional, reviewed, and reproducible.

## Local commands

```sh
npm ci
npm run dev
npm run tauri -- dev
npm run check
npm run test:coverage
```

Rust validation:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo audit -f src-tauri/Cargo.lock
```

## Change workflow

1. Branch from protected `main`.
2. Add characterization tests before changing ambiguous behavior.
3. Keep mechanical refactoring separate from behavior changes where practical.
4. Run `npm run check` locally.
5. Open a focused PR using Conventional Commit semantics.
6. Merge only after the protected cross-platform `Release gate` succeeds.

## Module rules

- `App.tsx` is composition, not a state machine.
- Feature behavior belongs under `src/features/<feature>`.
- Shared visual components cannot depend on product features.
- Tauri imports belong in `src/platform` or `src/bridge.ts`.
- Engine modules cannot depend on UI or desktop modules.
- Public workbook formats and source-data contracts require regression tests and
  explicit migration notes before a breaking change.

The architecture verifier encodes these rules; update a budget only when the PR
explains why the larger module is more cohesive than a split.

## Test strategy

- Unit tests cover normalization, classification, validation, reducers, and
  pure document rules.
- Integration tests use real workbook/PDF boundaries and generated artifacts.
- Performance tests protect representative large BOQs.
- Native CI validates the Rust boundary and all supported package formats.
- Security tests verify lifecycle-script policy and dependency audits.

Never use customer BOQs, production credentials, or personal data in fixtures.
