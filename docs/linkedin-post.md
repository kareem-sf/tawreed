# LinkedIn post drafts for Tawreed v0.0.1

Three options below, pick the one that fits your voice. All three
are sized under LinkedIn's 3,000-char limit and have been kept
honest — no "revolutionary", "game-changing", "10x your
productivity" copy. The product does what it does; the post
describes it.

---

## OPTION A — solo-founder / ship-it (short, direct, 1,180 chars)

Shipped Tawreed v0.0.1 today — a desktop app I built solo for a
problem I kept running into as a QS in MENA construction.

**The problem**: a Bill of Quantities arrives as a 5,000-row Excel
dump, and a quantity surveyor has to manually re-group every item
into work packages (foundations, MEP, finishes, etc.) before
procurement can act on it. That grouping step takes hours per BOQ
and is mostly mechanical.

**What Tawreed does**: drop the BOQ Excel, pick your LLM provider
(OpenAI, Anthropic, Gemini, or any OpenAI-compatible endpoint like
MiniMax/Groq/vLLM/Ollama), and the app streams a work-package
re-categorised Excel back to you in seconds. Arabic + English,
LTR/RTL-aware.

**Why a desktop app, not a SaaS**: BOQs contain pricing. The
client doesn't want a third-party server seeing it. Tawreed runs
locally; your LLM calls go only to the provider you configured.
API keys live in the OS credential store, never on disk.

Single-file binaries — Windows / macOS / Linux. No installer, no
folder of DLLs, no account, no telemetry.

→ https://github.com/sfkareem/tawreed/releases/tag/v0.0.1

Open to feedback from anyone doing BOQ → work-package workflows
in construction, especially in MENA where the Arabic/English
mixed sheets are the painful case I'm most curious about.

---

## OPTION B — engineering-pilled (medium, 1,860 chars, with bullets)

Tawreed v0.0.1 is out.

It's a Python/PySide6 desktop app that takes a construction Bill of
Quantities (BOQ) Excel and re-emits it as a structured work-package
workbook, with the categorisation done by an LLM. I shipped it
today after a hard push to get the security model right before
announcing.

A few things that mattered to me getting this to a state I'm
comfortable linking publicly:

• **API keys go to the OS credential store, not config.json.** The
  very first thing I built stored them in plaintext JSON, realised
  that was a non-starter, and ripped it out before tagging v0.0.1.
  On Windows that's Credential Manager (DPAPI-bound to the user
  account); on macOS, Keychain; on Linux, libsecret with a
  documented fallback for headless installs. The "Reset everything"
  button in Settings wipes the keyring too — resetting is not a
  half-job.

• **All state under `~/.tawreed/`.** No Windows Registry writes,
  no `%APPDATA%`, no junk next to the EXE. There's a
  `SECURITY.md` that says this explicitly.

• **One-file binary, three platforms.** `Tawreed-windows.exe`
  (41 MB), `Tawreed-macos` (44 MB), `Tawreed-linux` (90 MB).
  No installer, no prerequisite, double-click to run.

• **Multi-provider LLM.** OpenAI, Anthropic Claude, Google Gemini
  (via the OpenAI-compat endpoint), or any custom base URL — works
  with MiniMax, Groq, Together, vLLM, llama.cpp, Ollama. Provider
  and model are selected in the GUI, not buried in env vars.

• **Arabic + English with proper RTL switching.** This is the
  MENA-construction case and the reason I built it. Most BOQ
  tools either don't speak Arabic or render it left-aligned.

• **120 pytest tests, CI green on Ubuntu + Windows × py3.10/3.11/3.12.**

What's NOT in v0.0.1: a polished installer, code signing, auto-update.
The unsigned EXE triggers Windows SmartScreen the first time —
that gets a "More info → Run anyway" prompt, which is fine for an
open-source project but bad for a sales-led distribution model.

If you're a QS or a construction-tech founder and want to see if
this fits your BOQ workflow, the Windows/macOS/Linux binaries
are linked below. Issues, ideas, and edge cases welcome.

→ https://github.com/sfkareem/tawreed/releases/tag/v0.0.1

---

## OPTION C — short tweet-thread (1,400 chars, 5 tweets)

**1/5**
Shipped Tawreed v0.0.1 today. Desktop app, Python + PySide6.

Problem it solves: re-grouping a 5,000-row construction Bill of
Quantities Excel into work packages. Used to take hours per BOQ.
Now takes seconds + LLM. ⬇

**2/5**
Multi-provider. OpenAI / Anthropic / Gemini / any OpenAI-compat
endpoint (MiniMax, Groq, vLLM, Ollama).

Arabic + English. RTL/LTR switches based on the active language —
most BOQ tools don't handle mixed Arabic-English sheets at all.

**3/5**
Local. No SaaS, no telemetry, no third-party server seeing your
BOQ (which has pricing in it).

API keys → OS credential store. Not config.json, not anywhere on
disk in plaintext.

**4/5**
Single-file binaries:
- Tawreed-windows.exe (41 MB)
- Tawreed-macos (44 MB)
- Tawreed-linux (90 MB)

No installer. No account. No folder of DLLs.

**5/5**
Open source, MIT licensed.

→ https://github.com/sfkareem/tawreed/releases/tag/v0.0.1

If you're a QS in MENA construction, this is built for you. Try
it and tell me what breaks.

---

## Suggested hashtags (for LinkedIn A or B, optional)

#ConstructionTech #QuantitySurveying #BOQ #ConTech #PropTech
#OpenSource #BuildInPublic

(LinkedIn treats hashtags as search terms; 5-8 is the sweet spot,
any more looks spammy.)

---

## Visual assets to attach to the LinkedIn post

1. `docs/screenshots/workspace.png` — the Workspace page (drop a BOQ,
   click Process)
2. `docs/screenshots/settings.png` — the Settings page (provider,
   model, base URL, API key, Danger Zone)

Both PNGs are 1280x800, dark theme, readable. Don't add the tawreed
logo or watermarks — the screenshots speak for themselves.

---

## One-line bio blurb if you want to pin it

"Built Tawreed: a desktop app that uses LLMs to re-package
construction BOQs. Open source, MIT, single-file binary, multi-
provider. https://github.com/sfkareem/tawreed"
