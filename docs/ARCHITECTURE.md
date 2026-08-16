# Architecture

## Product shape

Tawreed is a modular, local-first desktop application. React renders the
workflow, Web Workers run document-heavy TypeScript, and a Tauri 2/Rust host
owns privileged operations. It is intentionally a modular monolith: the product
does not need network services, queues, or microservices for its current scope.

```text
React application shell
  ├─ app configuration and dialogs
  ├─ workflow reducer and orchestration hook
  ├─ review, settings, history, onboarding, and about features
  └─ desktop adapter
       └─ typed Tauri bridge

Web Worker / engine
  ├─ spreadsheet and PDF ingestion
  ├─ local OCR and document intelligence
  ├─ deterministic + optional grounded classification
  ├─ validation and human-review contracts
  └─ workbook generation

Rust host
  ├─ constrained filesystem and URL operations
  ├─ atomic revision publication
  ├─ SQLite settings/history/project memory
  ├─ native credential storage
  ├─ Codex/Anthropic-compatible provider bridges
  └─ signed-release metadata validation
```

## TypeScript ownership

### `src/app`

Composition only. `App.tsx` selects startup/onboarding/application states;
`AppDialogs` owns modal/drawer composition; `useAppConfiguration` owns bootstrap,
locale, processing preference, onboarding state, and update checks.

### `src/features`

Feature modules own product behavior and feature-specific UI:

- `workflow/` — explicit reducer, async orchestration, worker cancellation,
  consent, publication, and state views.
- `review/` — package summaries and item-level classification review.
- `settings/` — general preferences and provider setup.
- `onboarding/`, `history/`, `about/` — isolated product surfaces.

Feature modules may use shared components and the typed bridge. Shared
components must not import feature modules.

### `src/components`

Small reusable visual primitives only: title bar, loaders, logo, error boundary,
and low-level motion/background helpers. Product workflows do not belong here.

### `src/platform`

Platform-specific adapters. Components do not import Tauri APIs directly;
window and drag/drop behavior is exposed through the desktop adapter.

### `engine` and `shared`

The engine is UI-independent. `shared/types.ts` is the contract used by the
engine, workers, UI, and Rust serialization boundary. Engine code must not
import React, Mantine, Tauri, or feature modules.

## Workflow and state

The workflow reducer models five explicit views: idle, busy, consent, review,
and done. Async orchestration lives in `useBoqWorkflow`; presentation lives in
`WorkflowWorkspace`. This separation keeps state transitions deterministic and
testable while retaining cancellation and retry-safe publication.

The publication contract is expand-and-commit:

1. Reserve a revision and hidden staging session.
2. Generate all artifacts without exposing a partial release.
3. Write and validate the complete bundle.
4. Atomically promote the staging directory.
5. Preserve artifacts only when the error is explicitly retryable; otherwise
   discard the reservation.

## Data and trust boundaries

Runtime data lives under `~/.tawreed`:

```text
settings.json
history.sqlite
logs/app.log
output/<project>/Rev XX/
bin/codex[.exe]
.env                  # compatibility fallback only
```

The browser-facing CSP does not permit arbitrary network access. Rust performs
approved HTTPS operations and validates paths, hosts, update tags, package
names, and provider payload limits. AI suggestions are reconciled against
existing source identifiers; they cannot create quantities, units, item codes,
project names, or citations.

## Enforced architecture checks

`npm run verify:architecture` fails on:

- import cycles;
- unreachable TypeScript source;
- oversized application modules beyond reviewed budgets;
- direct Tauri imports outside the platform/bridge boundary;
- reintroduced legacy chart/animation abstractions;
- duplicate or unused UI-framework dependencies.

The protected CI gate additionally verifies npm/Rust security, Windows/Linux/
macOS native builds, startup behavior, vendored assets, and release integrity.
