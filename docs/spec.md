# Tawreed specification

## What Tawreed is

Tawreed turns construction bills of quantities into procurement packages. An engineer adds one or more BOQs for a
project; the Tawreed agent reads them, designs a package structure that fits the project and the supplier market,
places every BOQ item in exactly one package, and publishes workbooks the engineer can send to specialist suppliers
and subcontractors for pricing. The engineer stays in the loop and approves at every gate.

Tawreed never changes what the BOQ says. Item codes, descriptions, units, quantities, rates, amounts and comments
reach the outputs exactly as they are in the source.

## Who uses it

Quantity surveyors, estimators and procurement engineers working on their own computer, on BOQs in English, Arabic
or both. They know construction; they should not need to know anything about AI models.

## The work

1. **Project.** The engineer creates a project and adds BOQ files. A project can hold several BOQs.
2. **Reading.** Tawreed keeps an unchanged copy of each file and reads it. The agent works out each file's layout
   (which sheet, which header row, which column is the quantity, where a PDF's columns fall); Tawreed extracts the
   exact values into the project's item ledger, each item linked to its cell or page. Scanned pages are read by the
   AI from the page image; those rows are marked "read from image — verify" and shown beside the page.
3. **Overlap.** When a new file overlaps the project's existing sources, the engineer decides whether it is an
   addition, a replacement or a revision. *(Gate)*
4. **Package plan.** The agent proposes the packages: a name, the scope each covers and why. It balances clear
   specialist scope, how suppliers and subcontractors actually trade, practical package size and no needless
   fragmentation. It uses the project's rules and any rules the engineer promoted to all projects. The engineer
   approves the plan, edits it directly, or asks the agent to change it. *(Gate)*
5. **Assignment.** The agent places every item in one package. Items it cannot place with confidence are shown
   with the candidate packages and its reasoning; the engineer picks, and chooses whether the choice applies to
   this item, the project (default) or all future projects. *(Gate)*
6. **Checks.** Tawreed verifies that every active item appears exactly once and that package totals reconcile with
   the source totals.
7. **Publish.** The engineer previews the result and approves. *(Gate)* Tawreed writes the whole revision at once:
   either all of it appears, or none of it does.

The four gates always stop for the engineer. Between them the agent works on its own. At any time the engineer can
write to the agent ("split MEP into electrical and plumbing", "why is this item in finishes?") or change packages
directly: move items, rename, merge, split. Both routes run the same checked operations.

## Inputs

Excel (`.xlsx`, `.xlsm`, `.xls`), CSV (including Arabic Windows-1256), ODS, searchable PDF, scanned PDF and page
images. Any layout: there is no required template.

## Outputs of a revision

- **Master workbook:** cover, package index with item counts and totals, one sheet per package.
- **Package workbooks:** one standalone workbook per package, ready to send.
- **Decision log:** what the agent decided and what the engineer decided, with reasons and rules applied.
- **Coverage check:** every source item once, and source totals against output totals.

Revisions are numbered `Rev 00`, `Rev 01`, … and kept under the project in `~/.tawreed`, with Open folder and
Export to… actions. Arabic projects get right-to-left sheets.

## AI

- API keys for Anthropic, OpenAI, Google, xAI and one OpenAI-compatible endpoint.
- A ChatGPT subscription, only through the official Codex client. Tawreed never reads or copies its sign-in
  tokens.
- A model can be used only after Tawreed checks that it calls tools correctly. The same check records whether it
  can read images, which scanned pages need.
- The first time a project's content would go to a connection, Tawreed shows what is sent and where, and asks.
  The answer is remembered for that project and connection.
- Without a working connection, projects, sources and past revisions stay open and files can still be read;
  package planning waits for the agent.
- No spending controls in v1. Each agent turn has a step limit, and the agent pauses after a run of turns without
  hearing from the engineer.

## Interface

Tawreed is a tool, not a workspace. One window with four tabs: **Home**, **History**, **Settings** and **About**.

- **Home** starts as a drop zone ("Drop BOQ files here", or Choose files) with the recent projects below it.
  Dropping files starts the work; dropping more files onto a running project adds them to it.
- While the agent works, Home shows the project name, a five-step line (Read · Plan · Place · Check · Publish), the
  one thing waiting for the engineer (a decision card, when there is one), the agent's messages, and a box to write
  to the agent. Packages and items open from a link when the engineer wants to look or edit.
- When a revision is published, Home shows what was written and Open folder / Export to….
- **History** lists past projects and their revisions; opening one returns to Home for that project.
- **Settings**: language, theme, the AI Tawreed works with, connections, and rules that apply to all projects.
- **About**: version, data folder, logs, updates and licences.

Minimal and calm: white (or near-black in dark mode), hairlines, black primary buttons, and one amber accent that
means "needs you". No sidebars, dashboards or decoration.

## Language and platform

English and Arabic interface with full right-to-left layout; the agent answers in the interface language. English
text uses Figtree and Arabic text uses Thmanyah Sans: light headings, regular body text. Light and dark themes, following the system. A desktop app on
Windows first.

## Data

Everything Tawreed manages lives in `~/.tawreed`: AI connections and keys in `auth.json` (plain text, readable only
by the user, never shown in full or logged), settings in `settings.json`, projects in the database, source copies
and revisions under each project. Supplied files are never changed.

## Not in v1

Material takeoff, internal and for-pricing output variants, sending enquiries, bid comparison, other operating
systems, spending controls.

## Done when

- A synthetic multi-BOQ project in English and in Arabic goes through every gate and publishes a revision whose
  coverage check passes.
- A real BOQ (`BoQ - Package 04 (Combined) - R1`, kept private and never committed) publishes with full coverage and
  reconciled totals, and the engineer spot-checks a sample.
- Every provider type passes its connection check.
- Service tests, interface tests, typecheck and lint pass in CI, and a Windows installer is on GitHub Releases.
