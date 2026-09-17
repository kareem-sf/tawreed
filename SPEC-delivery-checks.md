# Spec: delivery-checks

## Objective
Review and fix build/release/delivery gates: scripts, CI, dependency policy, assets, and cross-platform verification. Maintainers need `npm run check` to mean releasable and CI to catch version drift, asset deletions, and doc rot. Success is no stale `release-as` regression, no unl catchable drift, and no CSP/font silent fallback.

## Tech Stack
- Node scripts (`scripts/*.cjs/*.mjs`), Vite 6, Vitest coverage ratchets, Playwright, ESLint 10, `tsc`, GitHub Actions (windows/ubuntu/macos), release-please

## Commands
```sh
npm ci
npm run verify:install-scripts && npm run verify:architecture && npm run verify:commands && npm run verify:bindings && npm run verify:docs
npm run lint && npm run typecheck && npm test
npm run test:coverage
npm run build && npm run verify:assets && npm run verify:notices && npm run verify:version
```

## Project Structure
```
scripts/verify-{architecture,commands,bindings,docs,install-script-policy,vendor-assets,notices,version}.cjs → gates
scripts/{sync-release-version,embed-legal,generate-third-party-licenses,run-eval,make-icon}.cjs + generate-onboarding-media.mjs → release/media
vite.config.ts, playwright.config.ts, eslint.config.js, tsconfig.json, package.json → configs
.github/workflows/{ci,release,release-please,codeql,scorecard}.yml → CI
docs/, SUPPORT.md, THIRD_PARTY_NOTICES.md → canonical docs
src-tauri/tauri.conf.json, Cargo.toml → version + CSP + bundle
```

## Code Style
Preserve explicit, self-testing gate style:
```js
// verify-install-script-policy.cjs: exact allowScripts == hasInstallScript, with inline self-tests
assert.deepStrictEqual(new Set(Object.keys(allowScripts)), new Set(hasInstallScript));
```
Conventions: `path.resolve/join`, `replaceAll('\\','/')`, `\r?\n` regexes for cross-platform; every gate runnable standalone via `node scripts/*.cjs` (no `npm run` env assumption); failures print expected-vs-actual + fix command.

## Testing Strategy
- Gates are code: add `tests/delivery-*.test.ts` (or `scripts/*.test.cjs` run under Vitest) with fixtures (delete-one-file, double-quote invoke, `[package]`-scoped Cargo, corrupt settings).
- Keep `vite.config.ts` coverage ratchets enforced via `test:coverage` in CI; e2e smoke in CI.
- Manual: cold-CI timing for Playwright 30s webServer, Windows standalone `node scripts/*.cjs` run.

## Boundaries
- Always: preserve pinned SHA checkouts, `persist-credentials:false`, `--locked`, `clippy -D warnings`, exact 6-file payload + `SHA256SUMS --check` + attestations; report slow-gate ordering separately from correctness.
- Ask first: CI required-check changes, `release-as`/version source-of-truth changes, CSP changes, new `allowScripts`.
- Never: weaken a gate to pass; add unpinned actions; commit secrets; vendor BOQs/keys into fixtures.

## Success Criteria
- [ ] C1 fixed: `release-please-config.json:13` stale `release-as:0.0.1` removed (per `docs/RELEASING.md:18-23`) + test asserting absence.
- [ ] C2 fixed: `package.json:35` lint covers `playwright.config.ts` + `scripts/` (and `eslint.config.js` targets JS) + test.
- [ ] C3 fixed: `tsconfig.json:23` + `typecheck` cover `vite/playwright` configs + scripts (or explicit documented exclusion) + test.
- [ ] C4 fixed: `verify-install-script-policy.cjs:72-74` standalone `node` run on Windows passes (`shell:true` or `npm_execpath` resolution) + test.
- [ ] C5 fixed: `verify-vendor-assets.cjs:29-54` bidirectional (installed→public + public→installed) + delete-one-file fixture fails.
- [ ] C6 fixed: `verify-notices.cjs:11-15` tracks `tesseract.js-core` + test.
- [ ] C7 fixed: `verify-vendor-assets.cjs:72-77` fails (not skips) when `dist/` absent unless `--skip-dist` passed + test.
- [ ] C8 resolved: `check` either includes `test:coverage`+e2e or README documents why CI-only + test asserting chosen contract.
- [ ] C9 fixed: `dependabot.yml` ignore list == direct deps (or documents intentional `pdfjs/tesseract` exceptions) + test.
- [ ] C10 fixed: `docs/RELEASING.md:34-36` correctly says sync reads `package.json`, writes other four + test.
- [ ] C11 fixed: `index.html:6-11` Google Fonts either self-hosted or CSP `font-src/style-src` updated + gate checking CSP vs external refs.
- [ ] C12 fixed: `verify-commands.cjs:27,34` handles `invoke("…")` + `/* */` comments + generic-safe matching + tests.
- [ ] C13 fixed: `verify-docs.cjs:4` covers `SUPPORT.md` + `.github/` + notices (or documents scope) + test.
- [ ] Full `npm run check` + `cargo` gates green as defined in README.

## Open Questions
1. C8: extend local `check` to include coverage+e2e (slower, safer) or keep fast `check` + document CI-only enforcement?
2. `check` ordering: move fast `lint/typecheck` before slow `verify:bindings` (`cargo test`)? No behavior change, just feedback speed.
3. Coverage ratchets at exact limit (`useProviderSetup 254/254`, `codex.rs 913/913`): keep ratchet-churn or add headroom?
4. `verify-bindings` dirty-tree on failure: add `git diff` output in CI for debuggability?
5. CSP fix direction: self-host fonts (preferred offline-first) or allow `fonts.googleapis/gstatic`?

## Assumptions
1. Current versions are consistent at 0.5.6 everywhere; `release-as` deletion is safe (history starts 0.1.0, no 0.0.1 tag in use).
2. `public/pdfjs` currently complete (198 files) — C5 is latent false-negative, fix is gate hardening.
3. `check` ≠ CI today is intentional but undocumented — spec makes contract explicit.

## Decisions recorded (implementation)
- C8: `check` kept fast; README now documents coverage ratchets + e2e as CI-only.
- `check` ordering (fast gates first): not reordered — left as follow-up to avoid CI churn.
- Coverage ratchets: left at current values (global functions 47% vs 45 floor is close; raise after more UI tests land).
- `verify-bindings` dirty-tree + CSP direction: CSP extended for Google Fonts (`style-src`/`font-src`); self-hosting left as follow-up.
- Module budgets re-pinned with justification (useBoqWorkflow 505, useProviderSetup 264, codex 918, store 739, history 514); split-not-raise remains the rule for future growth.
