# Tawreed

Tawreed is a local-first desktop application that turns construction BOQs into
reviewable, revision-controlled procurement work packages. It accepts dynamic
Excel layouts and searchable or scanned PDFs in English or Arabic without
requiring a fixed client template.

## What it does

1. Extracts quantified BOQ rows, project metadata, units, rates, totals, and
   relevant source comments.
2. Uses deterministic document intelligence and optional, explicitly approved
   AI assistance to propose work-package assignments.
3. Presents every assignment for human review while preserving source
   quantities and traceability.
4. Publishes one master workbook plus standalone package workbooks into an
   atomic project revision.

AI is never treated as a source of commercial facts. Item identifiers,
quantities, units, source references, and grounded comments remain authoritative.

## Download

Use the [latest GitHub release](https://github.com/kareem-sf/tawreed/releases/latest):

- Windows x64: `Tawreed-Windows-x64.exe`
- Linux x64: `Tawreed-Linux-x64.AppImage` or `Tawreed-Linux-x64.deb`
- macOS Intel and Apple Silicon: `Tawreed-macOS-universal.dmg`

Verify `SHA256SUMS.txt` and GitHub artifact provenance before execution. Current
packages are not commercially code-signed or Apple-notarized; platform warning
screens are therefore expected. See [Installation](docs/INSTALL.md).

## Trust model

- Workbook/PDF parsing, OCR, deterministic classification, validation,
  generation, history, and project memory run locally.
- BOQ content leaves the device only after an explicit provider-consent step.
- Rust owns privileged filesystem, process, credential, HTTPS, and update
  operations behind a typed Tauri boundary.
- Runtime data is stored under `~/.tawreed`; generated workbooks remain local.

See [Privacy](docs/PRIVACY.md) and [Security](SECURITY.md).

## Help

Start with the [user guide](docs/USER-GUIDE.md). For anything else, [SUPPORT.md](SUPPORT.md)
says where to ask.

## Development

Requirements are Node.js 24, the repository-pinned Rust toolchain, and the
platform dependencies required by Tauri 2.

```sh
npm ci
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- dev
```

`npm run check` verifies install-script policy, architecture boundaries,
documentation links, lint, types, tests, production assets, and version
consistency. Full native package and Rust security gates run in protected CI.

### Measuring classification accuracy

`npm test` scores the offline classifier against the labelled corpus in
`tests/eval/corpus-synthetic` and fails if grouping quality drops below the
floors in `tests/eval/eval.test.ts`. Because the model names each project's
packages itself, scoring compares groupings rather than codes — pairwise
precision/recall and cluster purity — so a correct grouping is never penalised
for its naming.

`npm run eval -- --provider anthropic` scores the same corpus against a real
provider, reading the key from `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or
`GROK_API_KEY`. It also picks up a private corpus in `tests/eval/corpus`, which
is gitignored so real BOQs never enter the repository; see the README there for
the file formats.

## Repository map

```text
src/app/                 application composition and configuration
src/features/            product features and workflow state
src/components/          small shared visual primitives
src/platform/            desktop-platform adapters
engine/                  UI-independent BOQ and document engine
shared/                  cross-layer TypeScript contracts
src-tauri/               Rust host and privileged boundaries
tests/                   deterministic regression tests
tests/eval/              classification accuracy harness and labelled corpus
scripts/                 architecture, security, release, and asset gates
docs/                    canonical product and engineering documentation
```

Start at the [documentation index](docs/README.md). Architecture and dependency
changes should follow [Contributing](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Kareem Safwat.
