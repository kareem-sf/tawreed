# Security

Report vulnerabilities privately to **kareem@kareemsafwat.com**. Do not publish
credentials or sensitive BOQ content in a GitHub issue.

## Local storage

Tawreed stores non-secret settings, run history, generated workbooks, and logs
under `~/.tawreed/`. It does not collect telemetry.

API keys are stored through the operating-system credential service: Windows
Credential Manager, macOS Keychain, or Linux libsecret. If Linux has no usable
secret service, Tawreed can fall back to an owner-only obfuscated local file.
That fallback is not encryption and must not be treated as a secure vault.

## Desktop boundary

The Tauri host accepts only an explicit engine-command allowlist and enforces a
payload-size limit. Its content security policy blocks remote scripts, frames,
objects, and arbitrary network connections from the webview. The embedded
engine is materialized into a user-private temporary directory, executed with
owner-only permissions on Unix, and removed on shutdown.

## Provider and BOQ data

The Codex provider reuses the user's existing ChatGPT login. Tawreed requests
model/account metadata through the official local protocol and never reads,
copies, logs, or stores the Codex token.

BOQ item text is sent only to the provider selected by the user. Inputs are
bounded and treated as untrusted data. Provider results must cover exactly the
requested item IDs before approval. BOQ rows, raw model output, secrets, and
filesystem paths are not rendered in the desktop interface.

## Generated files

Workbooks are written through a temporary file followed by an atomic replace.
Previous outputs are preserved with non-conflicting filenames. Credentials can
be explicitly replaced or removed through the storage API.
