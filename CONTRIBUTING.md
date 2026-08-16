# Contributing

## Before Opening a Change

Use an issue for substantial behavior or architecture changes. Never commit
real customer BOQs, generated workbooks, credentials, logs, or files from
`~/.tawreed`.

## Development Workflow

1. Create a focused branch from `main`.
2. Install dependencies with `npm ci`.
3. Add or update deterministic tests for behavior changes.
4. Run `npm run check`.
5. Run the Rust formatting, Clippy, and test checks:

   ```sh
   cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
   cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
   cargo test --manifest-path src-tauri/Cargo.toml --locked
   ```

6. Open a pull request using the repository template.

Keep changes small, preserve the local-first security boundary, and do not
allow AI output to create source facts. New bundled assets require pinned
provenance, checksums, and license notices.

## Dependency Install Scripts

The repository enables npm's strict install-script policy. `npm ci` fails when
a dependency adds a lifecycle script that is not covered by an exact reviewed
entry in `package.json#allowScripts`.

When a dependency update changes the pending-script set:

1. Run `npm approve-scripts --allow-scripts-pending` to list the packages.
2. Review the exact locked package version, its lifecycle script, source,
   maintainer, and why Tawreed requires it.
3. Approve only that version with `npm approve-scripts <package>`; do not use a
   name-only approval or `--dangerously-allow-all-scripts`.
4. Run `npm ci`, `npm run verify:install-scripts`, and the full checks before
   committing the updated policy and lockfile.

Remove stale approvals when the corresponding package or script disappears.
The policy verifier checks the allowlist against the lockfile and proves in an
isolated fixture that unreviewed scripts fail closed. A successful clean
`npm ci` proves that the exact reviewed scripts required by Tawreed still run.

## Commit and Pull Request Quality

Use Conventional Commit titles because merged pull requests drive automated
versioning and changelog generation: `feat:` for features, `fix:` for fixes,
and `type!:` or a `BREAKING CHANGE:` footer for incompatible changes. Use
`docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`, or `chore:` where
appropriate. Pull requests must explain behavior, testing, privacy impact, and
release impact. CI must pass before merge.
