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

## Commit and Pull Request Quality

Use concise imperative commit messages. Pull requests must explain behavior,
testing, privacy impact, and release impact. CI must pass before merge.
