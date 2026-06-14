# Security

## Reporting a vulnerability

Please **do not** file a public issue for security problems.

Email **kareem@kareemsafwat.com** with a description of the
vulnerability and a reproducer. Expect an acknowledgement within
72 hours and a fix or mitigation plan within 14 days, depending on
severity.

## Data storage

Tawreed is a **local desktop application**. It does not phone home
and does not collect telemetry. The only network calls it makes are
the ones you configure in the Settings page — to the LLM provider
you selected.

## API key storage

API keys are stored in the **OS-provided secure credential store**
(via the `keyring` Python package), not in the on-disk `config.json`:

* **Windows** → Credential Manager (DPAPI-bound to the user account;
  another Windows user on the same machine cannot read the value).
* **macOS** → Keychain. The user is prompted to allow Tawreed the
  first time it accesses the keychain.
* **Linux** → libsecret (GNOME Keyring / KWallet) when a secret
  service is available. On a headless Linux install (no D-Bus
  secret service running) Tawreed falls back to an obfuscated file
  at `~/.tawreed/.secret_fallback` (mode 0600). The fallback is
  **not** encrypted — it's a degradation path, not a security claim.
  Install `libsecret-1-0` and run a desktop session to get the
  real keyring.

### Why we changed this in v0.0.1

The v0.0.0 / pre-rewrite builds wrote the API key in plaintext to
`~/.tawreed/config.json`. That release was retracted on the same
day it was published. v0.0.1 stores the key in the OS keyring, and
runs a one-shot migration on first launch: any plaintext key it
finds in `config.json` (including in legacy state from
`%LOCALAPPDATA%\Tawreed` or `<exe-dir>/tawreed`) is moved to the
keyring and stripped from disk.

The obfuscated fallback file is created only when the OS keyring
is genuinely unavailable. It is *not* a "secure" store and should
not be treated as one — it's there so the app still works in
containerized / CI / WSL environments where no secret service
exists.

## State directory layout

```
~/.tawreed/
├── config.json          # provider, model, base_url — no secrets
├── db/tawreed.db        # history table
├── outputs/             # generated Excel workbooks
├── logs/
│   ├── tawreed.log      # rotating, 1 MB × 3
│   ├── crash.log        # unhandled exceptions (written by core/logging_setup)
│   └── migration.log    # breadcrumb left by the legacy-state migrator
├── single-instance.pid  # QLocalServer PID lock
└── .secret_fallback     # ONLY present when OS keyring is unavailable
```

The `.secret_fallback` filename starts with a dot so it is hidden
in a normal directory listing. The leading underscore is a
discouragement, not a real protection — anyone with read access to
your home directory can still recover the key. The file is created
with mode 0600 on POSIX systems (Windows uses NTFS ACLs, which
default to user-only access on modern Windows installs).
