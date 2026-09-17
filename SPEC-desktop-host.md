# Spec: desktop-host

## Objective
Review and fix Rust privileged boundary: filesystem safety, atomic revision publication, persistence, credentials, provider transport, updates, and IPC contracts. Users trust that `~/.tawreed` writes are atomic, secrets stay in OS keyring, and only `https` leaves the device. Success is no false deletion assurance, no revision spoofing, no IPC exfiltration, and every predictable failure actionable in UI.

## Tech Stack
- Rust (Tauri 2, `reqwest` rustls-tls, `rusqlite` bundled, `keyring` 4.1.5), TypeScript bridge `src/bridge.ts` + `src/bridge-schemas.ts` (zod)
- Contracts: `src-tauri/src/error_contract.rs` pins strings `src/features/workflow/errors.ts` matches

## Commands
```sh
npm ci
npm run verify:commands && npm run verify:bindings
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run lint && npm run typecheck && npm test -- tests/bridge.dom.test.ts tests/workflow-errors.test.ts
```

## Project Structure
```
src-tauri/src/            → Rust host (this module)
  store.rs                → ~/.tawreed layout, settings atomic write, keyring, SQLite, log_line
  commands/revisions.rs   → reserve/write/discard_revision, safe_component, ACTIVE_GENERATIONS
  commands/system.rs      → read_input_file, open_* confinement, app_log, settings
  commands/history.rs     → runs + classifications + memory (transactions, caps)
  commands/ai/{anthropic,openai_compat,retry,jobs}.rs → provider transport
  codex.rs, update.rs     → Codex CLI + GitHub update check
src/bridge.ts, src/bridge-schemas.ts, src/boq-worker.ts, src/workers/, src/platform/ → TS seam
src-tauri/capabilities/, tauri.conf.json → CSP + allowlist
```

## Code Style
Preserve explicit validation + atomic-write + capability-minimal style:
```rust
// safe_component strips traversal; safe_artifact_path enforces Packages/-only depth + .xlsx-only
pub fn safe_component(input: &str) -> String { /* strip <>:"/\|?* + controls, reserve CON/PRN */ }
```
Conventions: tmp+`replace_file` for every persistent write; `https_only(true)` everywhere; `deny_unknown_fields` on IPC structs; `log_line` newline-strip; cleanup on every error path.

## Testing Strategy
- Rust `#[test]` in-module (path sanitisation, URL allowlist, validation) + TS `tests/bridge.dom.test.ts`, `workflow-errors.test.ts`.
- Every fix gets a regression test (Rust unit or TS DOM): deletion-failure, session binding, artifact caps, redirect policy, error mapping.
- Manual: two-instance revision race, symlink `.csv` exfil, headless keyring, large (100 MB) input memory profile.

## Boundaries
- Always: preserve `safe_component`/`safe_artifact_path` traversal tests, `open_*` canonicalize confinement, keyring-only writes, `Policy::none` redirect stance; add caps instead of removing checks; report unverified OS-specific semantics.
- Ask first: CSP/capability changes, new network hosts, credential storage changes, `error_contract.rs` string changes (breaks UI mapping).
- Never: log secrets; weaken HTTPS/redirect/size caps to pass; commit without authorization; expose PII in temp files with lax perms.

## Success Criteria
- [ ] D1 fixed: `store.rs:500-516` `delete_api_key` returns Err (not Ok) when keyring entry fails + test.
- [ ] D2 fixed: `revisions.rs:179-200` `session` cryptographically bound to `revision` (reserve→publish mismatch rejected) + test.
- [ ] D3 resolved (decision): publish-preserve (`revisions.rs:254-259`) vs startup-wipe (`store.rs:64-77`) contradiction removed (preserve-or-wipe, plus message accuracy) + test.
- [ ] D4 fixed: `artifacts.len()` + total-bundle caps alongside per-artifact 268M check + test.
- [ ] D5 fixed: reported `master_path/files` use normalised separators (parity with `safe_artifact_path`) + Linux test.
- [ ] D6 fixed: `system.rs:31-66` symlink/canonicalize guard + CSV magic/allowlist decision + total-size cap + test.
- [ ] D7 resolved: `update.rs:66-79` digest either displayed/verified or dead code + i18n key removed; signature requirement documented.
- [ ] D8 fixed: `errors.ts:18-26` maps 256KB cap + revision/artifact errors to actionable messages (contract in `error_contract.rs:54-58`).
- [ ] D9 fixed: `anthropic.rs:23-27` redirect `Policy::none` + response cap (parity with `openai_compat.rs:211-248`) + test.
- [ ] D10 fixed: `codex.rs:377-386` dedup case-sensitive on Linux/macOS + test.
- [ ] D11 fixed: `history.rs:52-61` `deny_unknown_fields` parity + truncate-vs-reject policy documented + test.
- [ ] D12 fixed: `trace` element-count + string length caps before serialise + test.
- [ ] D13 fixed: `app_log` length/rate limit + test.
- [ ] `cargo fmt --check`, `clippy -D warnings`, `cargo test`, `verify:commands`, `verify:bindings` green.

## Open Questions
1. D3: keep “preserved for retry” across restarts (stop wiping `.tmp` on boot, add orphan GC with age), or change message to “retry within this session only”?
2. D6 CSV: restrict `read_input_file` to picker-granted paths / canonicalize-under-allowed-dirs, or keep any-path + symlink guard only?
3. D7 update trust: render `asset_sha256` with manual verify instructions, or remove digest theatre until Sigstore/minisign lands?
4. Temp-dir perms (`create_request_dir`): enforce `0700` on Unix — confirm no regression on managed multi-user hosts?
5. Settings corruption (`store.rs:85-93`): backup + surface error vs silent reset? Default: backup to `settings.corrupt.<ts>.json` + surface.

## Assumptions
1. Two app processes concurrently is in threat model (TOCTOU matters).
2. Renderer is untrusted for IPC size/shape (caps required).
3. `~/.tawreed/output` confinement (`canonicalize` + `starts_with`) is correct and must be preserved.

## Decisions recorded (implementation)
- D3 preserve-vs-wipe: startup sweep now removes only `.tmp` orphans older than 24h; fresh preserved-retry dirs survive restart.
- D6 CSV: any-path retained + symlink refused outright + post-read size re-check (no allowlist dirs).
- D7 update trust: `asset_sha256` now rendered via `t('updateChecksum')` with manual-verify instructions; no signature yet (documented gap).
- D11 truncate policy: kept (reject would break long-description callers); `deny_unknown_fields` added for parity.
- Temp-dir `0700` and settings backup: backup implemented (`settings.corrupt.<ms>.json`); temp-dir mode unchanged (follow-up).

## Residual round (2026-09-17, all fixed)
- Cross-process generation lock (`commands/revision_lock.rs`, split per gate philosophy) with 2h stale policy; retry budget is now true wall-clock (send races remaining budget).
- Worker transfers (no 2× copy); bridge base64 decodes chunked; request dirs `0700` on Unix (+CI test); system-PATH Codex candidates probed last.
- Log flood guard: 8KB/message + 100 lines/sec burst (pure policy fn, tested).
- Budgets re-pinned with justification (codex 939, store 775, revisions 509, history 514); split-not-raise remains the rule.
