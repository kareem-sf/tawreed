# Tawreed

[![CI](https://github.com/kareem-sf/tawreed/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kareem-sf/tawreed/actions/workflows/ci.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

Tawreed turns construction bills of quantities into procurement packages. Add the BOQs for a project; Tawreed's
fixed workflow reads them, designs the packages, places every item in exactly one package and publishes a master
workbook and one workbook per package. You approve at every gate, and nothing in your BOQ is ever changed. See
[the specification](docs/spec.md) and [architecture](docs/architecture.md).

- **The AI proposes, Tawreed computes.** An AI model reads the sheets, suggests the packages and places the items;
  Tawreed checks every proposal and computes every count and total itself.
- **Four gates.** Overlapping files, the package plan, items the AI is unsure of, and publishing all wait for you.
- **Every number traces back** to the cell or page it came from, one click away.
- **English and Arabic**, with full right-to-left layout.

## Your data

Tawreed runs on your computer and keeps everything in `~/.tawreed` (set `TAWREED_HOME` to use another folder):
projects in a local database, settings in `settings.json`, and AI keys in `auth.json`, which only your user account
can read. A project's content goes to an AI service only after you approve the consent card that names the service.
Tawreed works with an API key for Anthropic, OpenAI, Google, xAI or an OpenAI-compatible endpoint, or with a ChatGPT
subscription through the official Codex client.

## Status

Tawreed has been rebuilt from scratch and has not been released yet; its first release will be v0.0.1. Until then,
run it from source as described below. Progress is recorded in [docs/progress.md](docs/progress.md); the previous
Tawreed remains in the history before the rebuild.

## Open Tawreed

Double-click **Start-Tawreed.cmd**. It opens the desktop window, which starts the local service.

## Development

You need Python 3.12, Node 24 or later, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
(including Rust). Set up once:

```powershell
py -3.12 -m venv service/.venv
service/.venv/Scripts/python -m pip install -e "./service[dev]"
npm ci
```

On macOS or Linux, create the environment with `python3.12 -m venv service/.venv` and install with
`service/.venv/bin/python -m pip install -e "./service[dev]"`.

**Arabic font.** Tawreed's Arabic typefaces, Thmanyah Sans and Thmanyah Serif Display (headings), may only ship
inside the compiled app, so they are not in this repository. Put the `-Light`, `-Regular`, `-Medium` and `-Bold`
`.woff2` files of `thmanyahsans` and `thmanyahserifdisplay` from the official download into
`ui/src/fonts/thmanyah/` (ignored by git). Without them Arabic uses the system font.

`npm run dev` starts the interface at `http://localhost:1430`. The dev server also starts the service on a free
local port with a fresh access token, and forwards `/api` to it. `npm run tauri dev` opens the same interface in
the desktop window. Set `TAWREED_HOME` to use another data folder, for example a scratch folder for testing.

| Command | What it does |
| --- | --- |
| `npm run test:service` | Service tests |
| `npm run test:ui` | Interface tests |
| `npm run check` | Typecheck, Ruff and Clippy |
| `npm run verify` | `check`, then both test suites |
| `npm run build` | Typecheck and production build of the interface into `dist/` |
| `npm run bindings` | Regenerate the interface's API types from the service |

CI runs all of these on every pull request and fails if the API types are out of date.

## Windows installer

`npm run package` freezes the service with PyInstaller into `service/dist/tawreed-service/` and builds the NSIS
installer into `desktop/target/release/bundle/nsis/`. The installed app starts that service itself on a free local
port with a fresh token, forwards the interface's requests to it, and the service stops when the app does. Its log
is `service.log` in the app's log folder (`%LOCALAPPDATA%\com.tawreed.desktop\logs`).

`npm run release` then writes `SHA256SUMS.txt` beside the installer and prints the `gh release create` command for
a draft release. Make release builds on a machine with the Thmanyah files in place, so the installer carries them;
the script says whether it does.

## Contributing

Contributions are welcome: please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Report security problems privately,
as [SECURITY.md](SECURITY.md) describes. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Kareem Safwat.
