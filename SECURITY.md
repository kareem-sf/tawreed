# Security Policy

## Supported versions

Only the latest stable GitHub release receives security fixes. Older releases
should be upgraded after verifying the current package checksum and provenance.

## Reporting a vulnerability

Do not disclose exploitable details in a public issue. Use GitHub private
vulnerability reporting:

https://github.com/kareem-sf/tawreed/security/advisories/new

Include affected versions, impact, minimal reproduction steps, and suggested
mitigation. Do not include customer BOQs, generated workbooks, credentials,
Codex authentication data, or unredacted logs.

## Security boundaries

- Tauri exposes an explicit command allowlist; Rust validates privileged input.
- Local file operations canonicalize paths and constrain generated-output access.
- The webview CSP blocks arbitrary direct internet access.
- Updates are fixed to the official repository, canonical stable tags, and the
  expected package name for the current platform.
- Anthropic-compatible secrets use native credential storage where available;
  a mode-`0600` local fallback is used only when the platform store is
  unavailable.
- Codex credentials remain owned by the official Codex CLI and are not read by
  Tawreed.
- Codex jobs use isolated temporary working directories, bounded output,
  response schemas, cancellation, timeout, and read-only execution controls.
- AI output can assign existing source items but cannot create commercial facts.
- npm lifecycle scripts require exact reviewed approvals; GitHub Actions are
  pinned to immutable commit SHAs.
- Release packages include SHA-256 checksums, legal notices, and GitHub build
  provenance.

Current release packages are not commercially Authenticode-signed or Apple
Developer ID notarized. Verify checksums and provenance before execution.
