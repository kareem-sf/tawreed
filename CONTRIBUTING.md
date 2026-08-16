# Contributing

Use an issue for material behavior, architecture, security, or release changes.
Never commit customer BOQs, generated workbooks, credentials, logs, or files
copied from `~/.tawreed`.

## Pull requests

- Branch from protected `main` and keep the branch short-lived.
- Use focused Conventional Commit titles (`feat:`, `fix:`, `refactor:`,
  `perf:`, `test:`, `docs:`, `build:`, `ci:`, or `chore:`).
- Explain the problem, root cause, solution, user impact, tests, security/privacy
  impact, migration, deployment, and rollback.
- Add regression protection for fixed defects.
- Run `npm run check` and applicable Rust commands before review.
- Do not merge until the protected `Release gate` is green.

The complete workflow and module rules are in
[Development](docs/DEVELOPMENT.md) and [Architecture](docs/ARCHITECTURE.md).

## Dependencies and copied methods

Prefer existing project capability, platform APIs, and official framework
support before adding a library. Record the current and selected versions,
compatibility, security impact, license, migration, and rollback in the PR.
Third-party code or techniques must have a compatible license and a clear
technical fit; do not copy code based only on popularity.

npm lifecycle scripts are fail-closed. When a locked dependency introduces a
script, review the exact version and script, approve only that identity in
`package.json#allowScripts`, then run:

```sh
npm ci
npm run verify:install-scripts
npm run check
```

Never use name-only approvals or `--dangerously-allow-all-scripts`.
