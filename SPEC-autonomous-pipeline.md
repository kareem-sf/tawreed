# Spec: autonomous-pipeline

## Objective
Let repeat BOQs from known projects flow from file drop to published revision with zero clicks, while keeping every existing safety guarantee except the human review gate — which the operator explicitly removes per project. Users are firms processing recurring client BOQs where the layout is stable and past runs were clean. Success is: trusted projects publish unattended when machine-clean; anything else notifies and queues for human review; corrupt output is never published under any setting.

Non-goals: watch-folder daemon / running with the app closed (future phase); spend tracking or caps (explicitly declined — recorded as accepted risk below); changing the deterministic engine, machine gates, or memory rules.

## Tech Stack
- TypeScript React 19 + Mantine (settings/history UI), Rust Tauri 2 (settings allowlist, notification if feasible)
- Existing pipeline untouched: `inspectDocument` → `classifyPlan` → `validate` → `buildWorkbooks` → `reserve/write_revision_bundle`
- Contracts: `shared/types.ts` unchanged (no schema migration); auto-pilot runs identified by a trace marker event

## Commands
```sh
npm ci
npm run lint
npm run typecheck
npm test -- tests/workflow-reducer.test.ts tests/workflow-degradation.dom.test.ts tests/review-panel.test.tsx tests/autonomous-pipeline.test.ts
npm run build
```

## Project Structure
```
src/features/settings/      → TrustList UI (enable/revoke) + scope text
src/features/history/       → "Trust this project" row action (project name known here)
src/features/workflow/      → handleFile trust branch, auto-publish path, hold-for-review banner
src-tauri/src/store.rs      → ALLOWED_SETTINGS += autopilot trust-list key + validation
docs/, README.md, SUPPORT.md → trust-model rewrite (see Boundaries)
tests/autonomous-pipeline.test.ts → verdict + trust + queue behavior
```

## Code Style
Follow the existing reducer-purity + `role=alert/status` + bilingual-message conventions. Example (trust check reads like the existing consent gate):
```ts
// Trust is an explicit per-project grant, never a default — mirrors consent gating.
const grant = trustList.find((t) => t.projectKey === memoryKey(inspection.projectName));
if (grant) trace.push(workflowEvent('consent', 'completed', `Auto-pilot grant ${grant.grantedAt} covered this run`));
```
Conventions: trust keyed by `memoryKey(projectName)` (same normalization as memory); every autonomous decision lands in `trace`; no hardcoded UI strings (use `t()`); settings writes roll back on rejection (established pattern).

## Testing Strategy
- Framework: Vitest DOM + existing `pipeline-harness.ts`.
- New `tests/autonomous-pipeline.test.ts`: clean verdict auto-publishes (mocked reserve/write); unclean verdict queues to review with reasons; untrusted project keeps today's consent flow; revoked grant behaves as untrusted; trust-key normalization matches memory keys.
- Regression: full `npm test` + `cargo test` (settings-allowlist change) + `verify:commands` if new Tauri commands are added (prefer zero new commands — reuse `set_setting`/`getSettings`).
- Manual: end-to-end trusted drop → done screen; untrusted drop → unchanged consent; revoke mid-flight.

## Boundaries
- Always: machine gates stay absolute (`ZERO_QTY`, `UNCLASSIFIED_ITEMS`, 100MB/250-page, reservation/session binding); corrupt output never publishes under any setting; every autonomous step lands in `trace`; recordRun persists counts as today; add regression tests; report unverified areas.
- Ask first: new Tauri commands, new settings keys (allowlist change), notification-plugin capability changes, any engine change.
- Never: weaken a machine gate for autonomy; publish without a trust grant; memorize machine guesses (F1 rule stands — memory stays `source:'user'`-only); commit without authorization; leave docs claiming human review after this ships.

## Success Criteria
- [ ] Trust list stored per project (`memoryKey` normalization), default OFF, enable shows scope text, revoke works immediately (including mid-flight runs).
- [ ] Trusted drop skips the consent modal; trace records the grant basis; untrusted flow byte-identical to today.
- [ ] Machine-clean verdict = zero error issues + zero `WP-99` + zero `LOW_CONFIDENCE` findings. Clean → automatic generate + publish + done view. Unclean → review view with held-for-review banner listing reasons + error surfaced (no silent queue).
- [ ] Auto-pilot runs identifiable in history via trace marker (no schema change).
- [ ] Docs rewritten where they assert human review: README trust model, USER-GUIDE review flow, PRIVACY consent scope, consent-modal copy. Each rewritten claim links to this spec.
- [ ] `npm run check` + `cargo` trio green; no new architecture-budget breaches without re-pin justification.

## Open Questions
1. Trust-key collisions: two clients' "Tower C" share one normalized key, so trusting one trusts both. Accept with documented warning, or key on name + first-seen file hash lineage? Default: name-keyed + warning + one-click revoke.
2. Verdict strictness: any single `LOW_CONFIDENCE` item blocks auto-publish (strict, simple), or a share threshold (e.g. <5% auto-publishes)? Default: strict — any flag blocks.
3. `TOTAL_MISMATCH` / `RATE_OUTLIER` / `DUPLICATE_DESC` warnings publish unattended (recorded in trace/history) — acceptable, or should mismatch-class warnings also hold? Default: warnings don't block (machine-clean = errors + unclassified + low-confidence only).
4. Notification surface for held runs: in-app banner + history enough, or OS notification plugin too? Default: in-app + history; OS notification only if the plugin is already available without new capabilities.

## Assumptions
1. Single-instance operation is the norm; the cross-process file lock covers the rare second instance (no daemon in this spec).
2. Provider outage degrades to fallback classifications, which trip `UNCLASSIFIED`/`LOW_CONFIDENCE` and therefore queue — i.e. failure modes fail into human review, not into bad publish.
3. Repeat BOQs from trusted projects have stable layouts; layout drift shows up as low confidence and queues (correct behavior, not a bug).
4. Unattended provider spend is invisible by explicit operator decision (no accounting, no caps) — accepted risk, revisit if bills surprise.

## Decisions recorded (approvals)
- Full autonomous pipeline, no human publish gate (operator override with full trust-model consequences stated).
- Machine gates non-negotiable (corrupt output never ships).
- F1 memory fix ships first (done, 2026-09-17 round).
- Trigger: in-app per-project toggle (no daemon). Consent: per-project, default OFF. Unclean: notify + queue. Spend: neither.

## Build record (2026-09-17, all gates green)
- Slices A–F implemented per `tasks/plan-autonomous.md`; `tasks/todo-autonomous.md` all checked.
- `generate(overrideData?)` reuses the single publish path; grant re-checked before `writeRevisionBundle`; `useBoqWorkflow` re-pinned 516→584, `bridge` 359→393, `store` 775→835 (all with justification comments; split rule stands).
- Stray shadcn files from an external 12:02 PM event (`components.json`, `button.tsx`, `spectrumui/`, `spectrum-spike` test) removed under explicit approval — they tripped the legacy-path gate.
- Final: `npm run check` exit 0 (31 files / 240 tests), `cargo test` 76/76, fmt + clippy clean, coverage ratchets hold.
- Open Questions resolved as: strict verdict, warnings don't block, name-keyed trust + warning, in-app notify only.
