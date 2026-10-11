# Tawreed

A QS Mind product.

Tawreed turns construction bills of quantities into procurement packages. Add the BOQs for a project; the Tawreed
fixed workflow reads them, designs the packages, places every item in exactly one package and publishes a master workbook
and one workbook per package. You approve at every gate, and nothing in your BOQ is ever changed. See
[the specification](docs/spec.md) and [architecture](docs/architecture.md).

Tawreed keeps its data in `~/.tawreed`.

## Status

Tawreed is being rebuilt from scratch. Progress is recorded in [docs/progress.md](docs/progress.md). The previous
version is in git history at tag `legacy-final`.

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

Run `npm run verify` before every push. CI runs the same checks, and fails if the API types are out of date, only when
started by hand (Actions → CI → Run workflow), to stay inside the free GitHub Actions minutes.

## Windows and Linux packages

`npm run package` freezes the service with PyInstaller into `service/dist/tawreed-service/` and builds the NSIS
installer into `desktop/target/release/bundle/nsis/`. The installed app starts that service itself on a free local
port with a fresh token, forwards the interface's requests to it, and the service stops when the app does. Its log
is `service.log` in the app's log folder (`%LOCALAPPDATA%\com.qsmind.tawreed\logs`).

On Linux x64 the same native command builds an AppImage in `desktop/target/release/bundle/appimage/`.
Build each platform on its own operating system. AppImage uses Tauri's maintained Linux updater path.

`npm run release` prepares local checksums. With an updater public key configured, collect signed Windows and
Linux packages of the same version in one bundle folder and run `npm run release -- <folder>` to write a combined
`latest.json`. The script refuses a partial or unsigned feed. It does not publish. Make native builds with the
licensed Thmanyah files present; they may only ship inside the compiled app.

The app checks once when it opens, stays quiet offline, and installs only when the user presses Update and restart.
The key, selected release inputs and clean Windows/Linux test steps are in
[docs/2026-10-10-updater-and-installer.md](docs/2026-10-10-updater-and-installer.md).

## License

© 2026 QS Mind. All rights reserved. See [LICENSE](LICENSE).
