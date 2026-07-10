# Security

Report vulnerabilities privately to **kareem@kareemsafwat.com**. Do not publish
credentials or sensitive BOQ content in a GitHub issue.

## Local storage

Tawreed stores settings, history, outputs, logs, and window state under
`~/.tawreed/`. It does not collect telemetry.

API keys are stored through the operating-system credential service:

- Windows Credential Manager.
- macOS Keychain.
- Linux libsecret when available.

When Linux has no secret service, Tawreed uses an owner-only obfuscated fallback
file. This fallback is not encryption and should not be treated as a secure
vault.

## Codex

The Codex provider reuses the user's existing ChatGPT login. Tawreed discovers
the Codex runtime, requests account/model metadata through the official local
protocol, and starts a read-only classification turn. It never reads, copies,
logs, or stores the Codex token.

## BOQ data

BOQ item text is sent only to the provider selected by the user. The model has
no shell or arbitrary file tools. Inputs are size-bounded, treated as untrusted
data, and validated against the exact item-ID set before approval. BOQ rows and
raw model output are not displayed in the application UI.

## Generated files

Workbooks are written through a temporary file followed by an atomic replace.
Previous outputs are preserved with non-conflicting filenames. Reset can remove
local settings, credentials, history, UI state, and generated outputs only after
explicit confirmation.
