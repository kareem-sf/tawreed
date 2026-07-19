# Security Policy

## Supported Versions

Only the latest stable release is supported with security fixes.

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
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
- Anthropic keys are stored in plaintext under `~/.tawreed/.env`; protect the
  operating-system account and do not include that directory in diagnostics.
- Codex OAuth credentials remain managed by the official Codex CLI under
  `~/.codex` and are not read by Tawreed.

Version `0.2.0` does not use commercial Windows or Apple signing certificates.
Verify its published SHA-256 digest and GitHub provenance before execution.
