# Architecture

## Shape: a modular monolith

One developer, a local-first desktop app. Tawreed is one Python service with clear domain modules, one React
interface and a thin desktop shell — the same shape as its sibling app Quantix. No microservices, plugin system or
compatibility layers.

```
ui/        React + Vite + TypeScript, Tailwind + shadcn/ui, TanStack Query; API types generated from OpenAPI
desktop/   Tauri 2 shell: the window; installed, it also starts the service and forwards to it. No domain logic.
service/   Python 3.12, FastAPI, SQLAlchemy 2 + Alembic (SQLite), Pydantic AI
  tawreed/
    core/        data home ~/.tawreed, database, atomic JSON files, launch token
    ai/          connections and keys, the five API providers, the model check, subscription clients
    projects/    projects and consent records
    sources/     import, hashing, readers (Excel, CSV, ODS, PDF text with positions, page images), overlap
    ledger/      the immutable item ledger and the extractor that applies an agent-proposed layout
    packages/    package plans, packages, assignments, checked operations, rule memory
    decisions/   gates: overlap, plan, uncertain assignment, publish, consent, questions to the engineer
    agent/       the agent runtime, its tools and instructions, the MCP bridge for subscription clients
    publish/     workbook builders, coverage and totals checks, atomic revisions with a manifest
    api/         HTTP routes per module
  tests/
docs/
```

**Why:**

- One stack across Tawreed and Quantix: the same patterns, tools and habits.
- Pydantic AI covers all five API providers and lets tests drive the real runtime with a scripted model.
- Python has the strongest Excel, PDF and Arabic text tooling.
- SQLite through SQLAlchemy keeps the data in one local file with real transactions.

Each domain module owns its models, its service functions and the agent tools that call them.

## Boundaries

- The UI talks only to the HTTP API on loopback. Each service launch gets a fresh bearer token. In development the
  Vite server starts the service on a free port and forwards `/api` with the token, so the browser preview and the
  desktop window use the same path and the UI never holds the token or a key.
- AI connections and keys are in `~/.tawreed/auth.json`, locked to the current user. The service never returns a
  key, and keys are redacted from logs and prompts.
- `TAWREED_HOME` points the service at another data folder, for tests and scratch runs.
- Long work runs on background threads from records in the database: files waiting to be read, and the agent's
  turns, each recorded as it starts and ends. After a restart, a file left half-read is read again and a turn cut
  short is picked up again. The interface asks for the project's state every second or so while the agent works;
  it is a local service, so polling is simpler than a push channel and costs nothing noticeable.
- Database migrations run with SQLite's foreign keys off (SQLite changes a table by rebuilding it, and dropping
  the old table would otherwise delete every row that refers to it), then the references are checked before the
  migration is kept.

## The agent

- **One agent per project.** A background worker runs one turn at a time: a tool loop with a step limit. Each
  turn's context is rebuilt from the project's records, not carried as chat history.
- **Structure from AI, values from Tawreed.** The agent proposes layouts, plans and assignments. Tawreed extracts
  values, validates proposals and computes every count and total. The agent never writes an item field or a number.
- **Gates.** Nothing that changes the project's commitments happens until the engineer answers through the API.
  Tawreed itself raises consent (before a project's content first goes to a service) and overlap (when a new
  file repeats an earlier one); the agent's tools raise the plan, uncertain items, questions and publishing.
- **Real conversation.** The agent talks only through its message and question tools; the conversation shows
  exactly those records.
- **Untrusted documents.** BOQ text is passed to the model as delimited data and is never treated as instructions.
- **Stop** takes effect between steps. An AI failure pauses the agent with a plain reason.

### Providers

- API keys: Pydantic AI runs the tool loop against the chosen model.
- Subscriptions: Tawreed runs the official client (`codex`, `grok`) non-interactively in an empty working folder,
  with its own shell, file and web tools turned off and Tawreed's MCP bridge as the only tool server. The same tool
  definitions serve both paths.

## The installed app

- The service is frozen with PyInstaller into one folder and shipped as a resource of the NSIS installer (installed
  for the current user, no administrator rights). The interface is embedded in the Tauri executable.
- On start the desktop app picks a free loopback port and a fresh token, starts the service hidden with both, and
  answers the interface's requests to its own `api` scheme (`http://api.localhost` on Windows) by forwarding them
  to the service with the token. As in development, the page never holds the token.
- The app holds the service's standard input open; the service stops when it closes, so it can't outlive the app,
  even after a crash.

## Fonts

- **Figtree** (English) is open source (SIL Open Font License) and bundled with the interface from the
  `@fontsource-variable/figtree` package. Headings use Light (300), body text Regular (400), labels SemiBold (600).
- **Thmanyah Sans** (Arabic) is licensed for use inside a compiled or packaged product only. Its files must never be
  committed, uploaded or hosted anywhere, including GitHub, and must not sit loose where users can copy them. They are
  kept locally in the gitignored `ui/src/fonts/thmanyah/` and reach users only inside the Tauri executable, which
  embeds the built interface. The release interface is therefore served from Tauri's embedded assets, not from a
  folder on disk. Builds without the files (CI) fall back to the system Arabic font; release builds that include
  Thmanyah are made on the engineer's machine.

## Publishing

Workbooks are built with openpyxl into a staging folder, checked (every active item exactly once, totals reconcile)
and re-opened, then the folder is renamed into place as `Rev NN` with a manifest of file digests.

## Testing

Service tests use pytest; agent behaviour is tested with a scripted model at the provider boundary (Pydantic AI
`FunctionModel`), so the real runtime, tools, gates and database are exercised. Generated workbooks are re-opened
and asserted. UI tests use Vitest and Testing Library. CI runs tests, typecheck, Ruff and Clippy on every pull
request and fails if the API types drift from the service.
