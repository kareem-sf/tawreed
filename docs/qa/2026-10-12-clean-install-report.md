# Clean-install QA evidence — 12 October 2026

Verdict: NOT TESTED for complete clean Linux installation; 0/1 accepted. No product failure claimed. Steps 1 and 2 pass. Windows: NOT TESTED; this machine is Linux and no public Windows installer was tested.

Host: Omarchy 4.0.4 (Arch family), not a clean Ubuntu VM. Source checkout `0169641033bad0df0362355c4b66fd0992919a34` is not the published binary's source identity. Published package uses v0.1.0; do not infer that current source changes are included.

| Step | Exact action | Expected | Actual / evidence | Duration | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Anonymous Python urllib GET of public release API and both asset download URLs | Both files HTTP 200 | deb 84,012,360 bytes; SHA256SUMS 90 bytes; URLs and calculated hashes below | deb 50.41 s; manifest 0.79 s | PASS |
| 2 | `sha256sum -c SHA256SUMS` in download folder | OK, exit 0 | `Tawreed_0.1.0_amd64.deb: OK`, exit 0 | 0.194 s | PASS |
| 3 | Check host `/etc/os-release`; `docker info --format '{{.ServerVersion}}'` | Supported clean Linux desktop | Arch host; Docker permission denied at unix:///var/run/docker.sock; no dpkg/podman/distrobox available | Setup probe only | NOT TESTED |
| 4 | GET run-granted secret metadata `/api/agents/me/secrets` | Approved AI test connection | `{"secrets":[]}`; no key values requested and no founder sign-in used | Setup probe only | NOT TESTED |
| 5 | Generate and inspect synthetic CSV with Python csv/Decimal | Repeatable source baseline | Three source rows, amount sum 300, Concrete 240, Steel 60; no installed BOQ run | Not timed as installed run | NOT TESTED |
| 6 | No publish action taken | Approved revision and matched workbooks | No installed app, no workbooks or screenshots; no totals comparison can be claimed | — | NOT TESTED |

Raw download evidence:

```json
[
  {
    "file": "SHA256SUMS",
    "url": "https://github.com/kareem-sf/tawreed-releases/releases/download/v0.1.0/SHA256SUMS",
    "http": 200,
    "seconds": 0.79,
    "bytes": 90,
    "sha256": "ad8d7f29823cc8dbc533e732003894b49b3af348f802feb0843753ff37fb1a7f"
  },
  {
    "file": "Tawreed_0.1.0_amd64.deb",
    "url": "https://github.com/kareem-sf/tawreed-releases/releases/download/v0.1.0/Tawreed_0.1.0_amd64.deb",
    "http": 200,
    "seconds": 50.41,
    "bytes": 84012360,
    "sha256": "0a06329d24a434e411d42fba5581aac3a106e90f34344dfdf63aa82b9367c629"
  }
]
```

The initial check of the private `kareem-sf/tawreed` release endpoint returned 404; the issue's published release evidence correctly identified `kareem-sf/tawreed-releases`. This is not a release defect.

No application server or preview was started, no system package installed, no customer BOQ read, no live workflow or founder account used. No screenshots exist because installed GUI steps were not run. Temporary downloads are run-owned scratch and are removed by Paperclip.

Engineering Lead owns prerequisite delivery on QSM-278: a supported disposable clean desktop environment, an approved test AI connection, and one checklist review. QSM-265 stays blocked on that first-class dependency. The six-step checklist and Windows record are in ../clean-install-qa.md; synthetic input is clean-install-boq.csv. No under-30-minute end-to-end claim.

Repository verification: typecheck PASS; Ruff lint/format PASS. `npm run verify` stopped at Clippy because rustup has no default Rust toolchain; this is a setup limitation, not a failed product assertion. Service/UI suite results are recorded in the issue update. Documentation and CSV only; no product code changes.
