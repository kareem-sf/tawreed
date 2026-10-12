# GitHub-hosted verification and Linux release boundary

CI runs on pull requests, main pushes, version tags and manual dispatch. During rollout it also runs on `agent/qsm-229-hosted-ci`; remove that temporary push branch after acceptance. The stable required check is `Release gate`, which fails on skipped, cancelled or failed verification. Ubuntu 24.04 runs service lint/tests, UI tests, typecheck, clippy, API binding drift and a Linux deb compilation. Windows and macOS installation are deferred. This is a compilation check, not user installation evidence.

All Actions references are full upstream commit SHAs. Checkout does not retain credentials. Workflow permissions are contents read, timeouts bound each job, and concurrency cancels superseded checks. npm/pip and Cargo caches contain dependencies and verification outputs only. No proprietary fonts enter this workflow. No installer artifacts or frontend assets are uploaded; artifact retention is therefore zero. Do not add dist, font directories or customer data to caches or artifacts. Dependabot proposes weekly Actions pin updates, limited to three open PRs.

## Actual settings inspected 12 October 2026

Source repository `kareem-sf/tawreed` is private; main is its default branch. The connected identity has admin permission. Actions are enabled, all actions are allowed, SHA policy is not required globally, workflow token defaults to read, and workflow PR approvals are disabled. Existing cache usage was 28,554,022 bytes in two caches and no artifacts existed. Repository Actions secrets and variables were empty. Main protection GET returned HTTP 403: upgrade to Pro or make the repository public. Do neither: source privacy and no purchases are constraints. Engineering must enforce one review and green Release gate operationally until protection becomes available. Code scanning default setup GET returned 403 (not enabled); no paid security feature is enabled by this change. Account plan/remaining quota was not exposed by the inspected user response; included capacity must not be claimed as unused quota.

GitHub documents that private repositories consume plan quotas for hosted minutes and storage; cache/artifact storage can incur charges. No purchase, budget increase or billing setting change is part of this work. See [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [immutable Action pins](https://docs.github.com/en/actions/reference/security/secure-use).

## Release boundary and font supply

The approved Thmanyah licence forbids committing, uploading or hosting font files. GitHub secrets, encoded blobs, encrypted artifacts and private repositories are uploads too; none is a permissible workaround. The current permitted supply is local gitignored fonts used only to embed into the compiled app. A hosted source build cannot acquire those raw fonts under this rule. It can compile the source for verification, but that output cannot replace the accepted branded installer. Do not upload its fontless deb or publish a tag/feed from this workflow.

Engineering must specify a licence-compliant compiled-app supply or obtain explicit licence permission before enabling hosted release automation. Platform owns the public releases-only repository and publishes the existing accepted deb, without rebuilding it. This PR neither publishes nor creates tags/releases. The Linux config changes only bundle target to deb; app ID, updater endpoint, public key and signing settings are unchanged. No latest.json is produced; the current unconfigured updater is not bypassed. Automated updater publication remains gated on a valid signed release contract.

## Rollback

Revert this PR to restore manual-only CI; cancel queued runs through Actions. Delete only this workflow's obsolete verification caches if necessary. Leave existing public releases and shared services untouched. No installer, signing key, updater contract or app identity migration is required.
