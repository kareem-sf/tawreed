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

## 27 September 2026: reading BOQ files (service side)

- **Readers:** Excel, legacy .xls and ODS through calamine (the real 1.4 MB test BOQ reads in 0.3 s; openpyxl took
  29 s); CSV in UTF-8 or the Arabic Windows code page, delimiter detected; PDFs through PDFium as lines of words with
  their positions, Arabic in reading order (lam-alef ligatures fixed); images and scanned pages marked to be read
  from the page image. Password-protected and damaged files are reported with a reason.
- **Background reading:** new files are read one at a time after a drop; a restart resumes; one bad file never stops
  the reader. Each page's content is kept as JSON beside Tawreed's copy; page images are drawn once and kept.
- **Ledger:** the extractor turns a page and an agent-proposed layout (sheet columns, or PDF column positions with
  how descriptions run on) into items with their exact values, cell or line references and the nearest headings;
  headers, notes and totals are recognised; everything skipped is reported. Rows read from a page image are marked
  for checking. Overlap fingerprints note when a new file repeats or revises an earlier one.
- **Checks:** 82 service tests, Ruff. Synthetic English, Arabic and locked PDF fixtures are generated by
  `service/tests/fixtures/make_pdfs.py`.

## 27 September 2026: reading BOQ files (interface)

- **Files:** each file in an open project says where reading has got to (reading, how many sheets or pages, or that
  it couldn't be read, with a sentence on what to do). The project is asked again every second while anything is
  being read, and "Read" in the step line is marked as the current step.
- **Preview:** a read file opens beneath its name. Sheets show as a grid with Excel's row numbers and column letters,
  every cell exactly as read (no rounding or grouping), 200 rows at a time; hidden sheets are labelled. PDF pages and
  images show as pictures one page at a time; a page with no text says it will be read from the image and checked.
  Page pictures are fetched like every other request, so they will carry the same access in the installed app.
- **Found and fixed:** dragging a page picture inside Tawreed dropped it back into the project as a new file (the
  browser offers a dragged picture as a file). The drop area now ignores drags that start inside the window.
- **Checks:** 82 service tests, 33 interface tests, typecheck, Ruff and Clippy. In the browser, synthetic workbook,
  English and Arabic PDFs, a scan and a locked PDF were read in a scratch data folder and previewed in English and
  Arabic.
- **Next:** the agent (M5).

## 27 September 2026: the agent

- **Worker:** one agent per project on a background thread, a turn at a time (30 model requests at most), each
  turn's context rebuilt from the records: the files and what was done with each page, the approved packages,
  coverage, the engineer's rules, what waits for them, what they decided, the conversation and what is new. A
  project gets a turn when the engineer wrote or answered, when its last turn was cut short, or when there is work
  it can do without waiting; after 15 turns without hearing from the engineer it pauses. Stop takes effect between
  steps. An AI failure that usually clears is retried twice; otherwise the project pauses with a plain reason.
- **Tools:** list and read files (sheet cells with Excel's rows and columns; PDF words with their positions; page
  pictures for scans), lay out sheets and PDF pages, transcribe scans, set pages aside, list items, propose the plan,
  place items by number and range, flag an uncertain item, check the work, ask to publish, message and ask the
  engineer. File text reaches the model fenced as data. No tool can answer for the engineer.
- **Gates:** consent before a project's content first goes to a service (Tawreed raises it; the card names the
  service); overlap when a new file repeats an earlier one (Tawreed raises it with a suggestion; a revision carries
  each unchanged item's package over, and the engineer's placements stay the engineer's); the plan (keep, rename,
  merge, split or remove packages); uncertain items (the choice can become a rule for the project or all projects);
  questions; publishing (recorded; writing the revision is next).
- **Packages:** every item has at most one assignment row, so it can't be in two packages. Items have short numbers
  within the project and packages codes ("03") that are never given again. The engineer edits directly: create,
  rename, merge, remove, move items; the agent never moves an item the engineer placed.
- **Interface:** the step line follows the real stage; the one decision waiting (with how many more), the
  conversation with the engineer's answers and Tawreed's notices, the message box and Stop; a packages summary and a
  packages view with each item's values as the file states them and a link that opens the file at that item (its
  row marked, or its box outlined on the page). Rules for all projects are listed in Settings. In Arabic, names set
  into a sentence are isolated so Latin file and sheet names don't reorder the words around them.
- **Found and fixed:** the database upgrade deleted every extracted item. SQLite alters a table by rebuilding it,
  and with foreign keys on, dropping the old projects and files tables cascaded into their items. Migrations now run
  with foreign keys off and the references are checked afterwards; a test upgrades a database with items in it.
  Also: package codes were reused after a merge; the plan card tagged every package of a first plan as new.
- **Checks:** 98 service tests (the agent end to end through every gate with a scripted model; stop, consent
  declined, AI failure, long run, document text fenced), 40 interface tests, typecheck, Ruff. In the browser, the
  real service with the scripted model went through consent, plan, an uncertain item and the publish request, in
  English and Arabic. Not yet run against a real AI service: that sends data out, so it waits for the engineer.
- **Next:** publishing the revision (M6).

## 27 September 2026: publishing a revision

- **What is written:** the master workbook (cover, package index with item counts and amounts, one sheet per
  package), one workbook per package, the decision log (the engineer's decisions, every placement with who made it
  and why, the rules, how each page was read) and the coverage check (items in use against items placed, the files'
  amounts against the packages', each total a file states beside its items' own sum, and every item with its
  package). Items appear under their headings, each with its source ("Tower BOQ.xlsx › Div.03 › row 10").
- **Values as the source states them:** a value the source wrote as a number goes out as that number, shown grouped
  with its own decimals, so nothing is rounded; anything else goes out as its text. A package's total is left out
  when none of its items has an amount, so unpriced work never reads as priced at nothing. A project whose items are
  mostly Arabic gets Arabic labels and right-to-left sheets. Sheets print landscape, one page wide, with the column
  headings repeated and page numbers.
- **All or nothing:** the workbooks are written into a staging folder, the master is read back and each package's
  items compared with the ledger, a manifest records every file's SHA-256, and only then does the folder become
  `Rev NN`. A failure leaves nothing behind and the publish request still waiting. A revision is never overwritten.
- **Interface:** approving publishing writes the revision; the project then shows it (its files, Open folder,
  Export… as a zip download) and every step as done; earlier revisions are listed, and History shows each project's
  latest.
- **Found and fixed:** after publishing, the agent was told to "check the work and ask to publish" again and did so
  at once; it now knows when the latest revision holds the current work, and its publish request is refused then.
- **Checks:** 105 service tests, 41 interface tests, typecheck, Ruff, Clippy. Workbooks were exported to PDF through
  Excel and looked at in English and Arabic; in the browser, a scripted project was published and shown.
- **Next:** ChatGPT/Codex and Grok subscriptions through their official clients (M7).

## 27 September 2026: subscriptions (stopped for the engineer's decision)

The plan runs ChatGPT/Codex and Grok through their official clients with the client's own shell, file and web tools
off and Tawreed's MCP bridge as the only tool server, and stops to report if a client can't be restricted that way.
Each client was run against a fake model endpoint on this machine that recorded exactly which tools it offered the
model, with the client's home folder in a scratch location: no subscription was used and no project data left the
machine.

- **The bridge works.** An MCP server serving Tawreed's 16 agent tools over stdio, for one project, with the same
  checks; refusals come back as tool errors. It is kept on the local branch `wip/m7-subscription-bridge`, not on
  main, because nothing uses it yet. It takes about 6 s to start (imports).
- **Codex 0.153.4:** `--ignore-user-config`, a read-only sandbox, an empty working folder and `--disable` for its
  shell, exec, image, multi-agent, apps, plugins, browser and computer-use features (plus web search off) leave only
  `request_user_input`, and `apply_patch` (file editing) for real model names. Two problems remain: the user's
  `~/.agents/skills` list is put into every prompt, and Tawreed's MCP tools never reached the model's tool list in
  these runs (Codex defers MCP tools behind a tool search this setup doesn't show). Not shown to be restricted.
- **Grok 1.0.30:** headless `-p` with an explicit allowlist `--tools "search_tool,use_tool"` offers only those two
  meta-tools; an *empty* allowlist offers all 25 built-in tools, terminal and file tools included. MCP servers from
  the user's own Grok config load alongside Tawreed's (reachable through `use_tool`) and would need denying by name
  (`--deny "MCPTool(name__*)"`); Claude and Cursor compatibility is on by default and would bring in the user's
  Claude MCP servers, hooks and personal instruction files unless switched off by environment variables. It can be
  restricted, but only by a long list of settings whose defaults can change between versions.
- **Not tested:** a real signed-in run, which uses the engineer's subscription.
