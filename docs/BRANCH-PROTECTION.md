# Branch protection and repository settings

`CONTRIBUTING.md`, `DEVELOPMENT.md`, and `RELEASING.md` all assume a protected
`main` and a required `Release gate` check. Those settings live in the GitHub UI,
not in the repository, so this page records them — otherwise they cannot be
audited, restored after an accident, or reproduced on a fork.

Apply these under **Settings → Rules → Rulesets**, targeting the default branch.

## Required ruleset: `main`

| Setting | Value | Why |
| --- | --- | --- |
| Target | Default branch | — |
| Restrict deletions | On | `main` must not be deletable. |
| Block force pushes | On | Release tags and provenance reference commits on `main`. |
| Require a pull request | On, 0 approvals | No direct pushes. Approvals are set to zero because a single maintainer cannot approve their own pull request; raise this to 1 the moment a second maintainer exists. |
| Dismiss stale approvals on push | On | An approval must apply to the code that merges. |
| Require conversation resolution | On | — |
| Require status checks to pass | On | See below. |
| Require branches to be up to date | On | The gate must have run against the merge result. |
| Require linear history | On | Squash merges only; keeps `release-please` changelogs readable. |
| Require signed commits | Recommended | Not currently enforced. |

### Required status check

Exactly one: **`Release gate`**.

It is the aggregate job in `.github/workflows/ci.yml` and it depends on all
three of `verify` (Windows), `frontend-tests` (Ubuntu + macOS), and
`platform-builds` (Linux + macOS bundles). Requiring the aggregate rather than
the individual jobs means a new platform can be added to CI without editing
branch protection.

## Known bypass — read before changing it

`.github/workflows/release-please.yml` posts a `Release gate` success status to
the release PR's head SHA via `POST /repos/{repo}/statuses/{sha}` after watching
the real CI run complete. This exists because the release PR is bot-authored and
its checks run under `workflow_dispatch`, which branch protection does not credit
automatically.

It is a deliberate, documented bypass, but it *is* a bypass: anything that can
write a commit status to `main`'s head can satisfy the gate. Two consequences to
accept explicitly before the repository goes public:

- The workflow must keep verifying the run actually succeeded (`gh run watch
  --exit-status`) and that the PR head has not moved before posting. Both checks
  are currently present — do not remove them.
- If the repository is ever opened to outside contributors with write access,
  replace this with a GitHub App token scoped to the release PR, or make the
  release PR run the checks under `pull_request` so no synthetic status is needed.

## Other repository settings

- **Actions → General**: "Allow GitHub Actions to create and approve pull
  requests" must be **on** (`release-please` depends on it). Workflow permissions
  set to read-only by default; every workflow declares what it needs.
- **Code security**: enable Dependabot alerts, Dependabot security updates,
  secret scanning, and **push protection**. Code scanning is supplied by
  `.github/workflows/codeql.yml`; supply-chain posture by
  `.github/workflows/scorecard.yml`.
- **Pull requests**: allow squash merging only; auto-delete head branches on
  merge.
- **Tags**: the `Protect release tags` ruleset targets `refs/tags/v*` and blocks
  deletion and non-fast-forward updates, so a release tag cannot be moved after
  publication — build provenance attestation is bound to the tagged commit. Tag
  *creation* stays open because `release-please` creates the tag itself.
