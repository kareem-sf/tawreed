# Tawreed

Tawreed turns construction bills of quantities into procurement packages. Add the BOQs for a project; the Tawreed
agent reads them, designs the packages, places every item in exactly one package and publishes a master workbook
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

**Arabic font.** Tawreed's Arabic typeface, Thmanyah Sans, may only ship inside the compiled app, so it is not in
this repository. Put `thmanyahsans-Light.woff2`, `-Regular`, `-Medium` and `-Bold` from the official download into
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

## License

[MIT](LICENSE) © 2026 Kareem Safwat.
