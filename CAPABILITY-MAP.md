# Capability Map: Tawreed reliability review

Approved scope for an evidence-based review and incremental defect remediation.

| Module id | Responsibility | Depends on |
|---|---|---|
| document-engine | Spreadsheet/PDF/OCR ingestion, normalization, classification, memory rules, validation, workbook generation | — |
| desktop-host | Rust filesystem safety, revision publication, persistence, credentials, provider transport, updates, IPC contracts | — |
| app-workflow | React state, cancellation/retry, consent, review, settings, history, accessibility, worker/host integration | document-engine, desktop-host |
| delivery-checks | Build/release scripts, CI, dependency policies, assets, cross-platform verification | document-engine, desktop-host, app-workflow |

Review/fix order: document-engine and desktop-host → app-workflow → delivery-checks.

These are review ownership boundaries, not new runtime packages. Existing shared contracts remain authoritative.

## Approval gates

For each module: review evidence → Specify → human approval → Plan → human approval → Tasks → human approval → Implement → human review.

Module specifications use `SPEC-<module-id>.md`. Implementation plans and tasks use `tasks/plan.md` and `tasks/todo.md`, with module ids identifying their scope.

## Boundaries

- Always: investigate suspicions, distinguish confirmed defects from hypotheses, preserve intended behavior and checks, add regression tests for fixes, report unverified areas.
- Ask first: new dependencies, database schema changes, CI changes, external AI calls, changes to vendor/generated files.
- Never: commit without explicit authorization, expose credentials, weaken checks to pass, make speculative behavior changes.

## Initial baseline

- Working tree was clean before review artifacts.
- `npm test`: 24 test files passed, 1 skipped; 186 tests passed, 1 skipped.
- Existing skipped tests are baseline state, not changes made by this review.
- No implementation changes approved yet.

The review reduces risk; it cannot guarantee absence of every defect.
