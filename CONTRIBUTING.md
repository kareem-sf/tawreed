# Contributing

Thank you for helping. Tawreed is small on purpose: it turns bills of quantities into procurement packages, and the
engineer approves every gate. [AGENTS.md](AGENTS.md) holds the rules every change keeps; the product is described in
[the specification](docs/spec.md) and [the architecture](docs/architecture.md).

## Before you start

- For anything bigger than a small fix, open an issue first, so we agree on the problem before the code.
- Never add a real BOQ, a client's name, generated workbooks, keys, databases or anything from `~/.tawreed`. Tests and
  examples use synthetic data.
- Never add the Thmanyah font files: their licence forbids it (see [the README](README.md#development)).

## Set up

Follow [Development](README.md#development) in the README. Point `TAWREED_HOME` at a scratch folder so your own
projects stay untouched.

## Making a change

- Keep it focused: one problem per pull request, written like the code around it.
- Keep the rules: source values reach the outputs exactly as they are, Tawreed (not the AI) computes every count and
  total, every item sits in exactly one package, and the four gates always wait for the engineer.
- Add or update tests with the change. A fixed bug gets a test that would have caught it.
- If you change the service's API, run `npm run bindings` and commit the regenerated types.
- Every word the engineer reads has an English and an Arabic version (`ui/src/i18n`).
- Look at interface changes in the running app, in English and Arabic, in a wide and a narrow window, and say what
  you checked.
- `npm run verify` passes before you ask for review.

## Pull requests

- Branch from `main`. Title the pull request in [Conventional Commits](https://www.conventionalcommits.org) form, with
  a scope where it helps: `fix(service): …`, `feat(ui): …`, `docs: …`, `ci: …`.
- `main` takes pull requests only. The **Release gate** check must pass, conversations must be resolved, and history
  stays linear (rebase or squash).
- The template asks what changed, why, and how you checked it.

## Bugs and security

Report bugs with the [bug form](https://github.com/kareem-sf/tawreed/issues/new/choose). Report security problems
privately as [SECURITY.md](SECURITY.md) describes, never in a public issue.

By contributing, you agree that your contribution is licensed under the [MIT licence](LICENSE).
