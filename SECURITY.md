# Security Policy

## Supported Versions

Only the latest stable release is supported with security fixes.

| Version | Supported |
| --- | --- |
| 0.3.x | Yes |
| Earlier versions | No |

## Reporting a Vulnerability

Do not disclose vulnerabilities in a public issue. Use the repository's
private security advisory form:

https://github.com/kareem-sf/tawreed/security/advisories/new

Include affected versions, reproduction steps, impact, and any suggested
mitigation. Do not include customer BOQs, API keys, Codex credentials, or
generated workbooks.

## Security Boundaries

- Tauri exposes only explicitly registered commands to the webview.
- Input and generated-file commands canonicalize and constrain local paths.
- Update checks are fixed to the official repository and exact package for the
  running platform; release responses cannot provide arbitrary package URLs.
- The webview CSP does not permit direct internet requests.
- Anthropic keys are stored through the operating-system credential manager
  (Windows Credential Manager, macOS Keychain, or Linux Secret Service). A
  mode-`0600` `~/.tawreed/.env` fallback is used only when a native credential
  service is unavailable.
- Codex OAuth credentials remain managed by the official Codex CLI under
  `~/.codex` and are not read by Tawreed.
- Codex jobs use a fresh isolated working directory, a read-only sandbox,
  ephemeral sessions, ignored user rules/configuration, constrained JSON
  schemas, bounded output, cancellation, and a fixed timeout.
- Managed Codex downloads are accepted only when the GitHub release asset has a
  published SHA-256 digest matching the downloaded executable.

Release packages do not use commercial Windows or Apple signing certificates.
Verify their published SHA-256 digests and GitHub provenance before execution.
