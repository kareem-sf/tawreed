# Progress

## 27 September 2026: rebuild started

- The previous Tawreed was removed from `main`; it remains in git history at tag `legacy-final`.
- Uncommitted work at that point is archived on branch `archive/pre-rebuild-2026-09-27`; the
  `.worktrees/platform-foundation` changes are committed on `codex/platform-foundation` and the worktree removed.
- PR #89 (auto-pilot) and ten Dependabot PRs were closed as superseded.
- Personal ignored folders (`.remember`, `.superpowers`, `release`, the private eval corpus) moved to
  `D:\AI Work\_private-backups\tawreed-pre-rebuild-2026-09-27`; build output deleted.
- The old data home `~/.tawreed` and `~/.tawreed-signing` are for the engineer to delete. Until then, development
  runs use `TAWREED_HOME` pointed at a scratch folder.
- The product is specified in [spec.md](spec.md) and [architecture.md](architecture.md). The stack mirrors Quantix.

## 27 September 2026: design directions

- Three visual directions are on the private design canvas "Tawreed Design Directions": A Blueprint Ledger, B Desert
  Stone, C Graphite Precision. Each shows the packages workspace (light and dark) with the agent panel and an
  uncertain-assignment decision, plan approval in Arabic, and AI connections.
- The engineer chose none of them: Tawreed is a minimal tool, not a whole app. Drop a BOQ and the work starts; four
  tabs (Home, History, Settings, About). Thmanyah Sans for Arabic. For English the engineer turned down Calibri
  and left the choice among four light open fonts to Claude: Figtree, the most readable at small sizes and the
  closest match to Thmanyah Sans. Headings in Light, body in Regular.
- The canvas now holds the minimal design: drop, working with one decision, Arabic plan approval, revision ready
  (dark) and Settings. The Arabic board is a picture rendered locally with the real font, because the Thmanyah
  licence forbids uploading the font files anywhere.
- Thmanyah files stay out of git (`ui/src/fonts/thmanyah/` is ignored) and ship only inside the compiled app.

## 27 September 2026: skeleton

- **Service:** FastAPI, SQLAlchemy and Alembic under `~/.tawreed` (`TAWREED_HOME` overrides), with a per-launch
  access token on every route except `/health`. Projects start from dropped files: Tawreed keeps an unchanged copy
  of each, named by its content hash; the same file twice is kept once; one unusable file refuses the whole drop.
  Settings (language, theme) and About. Errors carry stable codes the interface translates.
- **Interface:** the four tabs, the drop zone with recent projects, the open project (editable name, files, the
  five-step line, and the no-AI notice, which is the real state until connections exist), History, Settings and
  About. English and Arabic with full right-to-left layout, Arabic plural forms and Latin digits; light, dark and
  system themes. Figtree is bundled; Thmanyah is registered only when its local files exist.
- **Desktop:** a thin Tauri 2 window; drops are handled by the page, so they behave the same in the browser. The dev
  port is 1430 because Quantix uses 1420, so both can run at once.
- **Checks:** 30 service tests, 19 interface tests, typecheck, Ruff and Clippy pass; the production build works with
  and without the Thmanyah files. In the browser, a synthetic CSV and PDF were dropped onto the real service in a
  scratch data folder, then Arabic, dark mode, History and About were checked.
- **Found and fixed:** Escape while renaming still saved the name; English file names in the Arabic view aligned to
  the wrong side; on Windows, stopping the dev server left the service running, because the venv's `python.exe` is
  a launcher (the dev plugin now stops the whole process tree; Quantix's plugin has the same gap).

## 27 September 2026: the Tawreed logo is back

- At the engineer's request, the previous app's logo returns: the "T" monogram with one source beam and two routed
  outputs. The app icons are the original files, byte for byte (from tag `legacy-final`), and `desktop/app-icon.svg`
  is the original gold source. In the header the same mark is drawn in the text colour beside the name, as the
  previous app last did, so it follows light, dark and Arabic. The browser tab uses the gold mark.

## 27 September 2026: AI connections

- **Connections:** Anthropic, OpenAI, Google, xAI and an OpenAI-compatible address, through Pydantic AI. A key is
  kept only after the service lists its models (an OpenAI-compatible service that can't list them is proved by the
  model check instead). Keys live in `~/.tawreed/auth.json`, which is re-locked to the current user after every write
  (Windows: inheritance removed, only the user's security ID keeps access; elsewhere 0600). The API returns only
  the last four characters.
- **Model check:** the model must hand back a one-off code through a tool call; then it is asked to read a number
  from an image, which records whether it can read scanned pages. Tawreed only works with a model that passed.
- **Settings:** the AI Tawreed works with (only checked models are offered), the connections (choose a model,
  check, remove) and adding a connection. Failures arrive as codes and read plainly in English and Arabic.
  Removing the connection in use clears the choice. Home's notice now points to Settings and disappears once an AI
  is chosen.
- **Not yet:** ChatGPT/Codex and Grok subscriptions come with the MCP bridge (M7), since their check needs it.
  Consent records come with the agent (M5), which is the first thing that sends project data.
- **Checks:** 45 service tests (no test reaches a real provider), 28 interface tests, typecheck and Ruff pass. In
  the browser, a fake key sent to Anthropic's real API came back as "The key was refused", with nothing stored.
  Found and fixed: in Arabic, the show-key button covered the start of the key.
