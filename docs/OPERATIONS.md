# Operations and Troubleshooting

Tawreed is a desktop product, so operations focus on local state, reproducible
packages, diagnostics, and safe recovery rather than server infrastructure.

## Health indicators

- The application starts and shows the file-import surface.
- About reports the installed semantic version.
- A BOQ can be parsed locally and reaches item review.
- Publication creates one complete revision directory, never a partial visible
  revision.
- `~/.tawreed/logs/app.log` contains no repeated fatal startup failures.

## Local recovery

1. Close Tawreed before changing local files.
2. Back up `~/.tawreed/output` and any required history.
3. Preserve `history.sqlite` when run history or project memory is required.
4. Remove only the affected setting/log file first; deleting all of
   `~/.tawreed` resets every local setting, history record, managed Codex binary,
   memory rule, and generated output.
5. Remove provider credentials through Settings because native credentials may
   live outside `~/.tawreed`.

## Diagnostics

Logs can include filenames, project names, local paths, and provider error
summaries. Redact them before sharing. Never attach source BOQs, generated
commercial workbooks, API keys, or Codex authentication data to a public issue.

For package/runtime problems, include:

- operating system and architecture;
- Tawreed version from About;
- package type (`.exe`, AppImage, DEB, or DMG);
- whether checksum and provenance verification succeeded;
- minimal redacted reproduction steps.

## Rollback

Desktop releases do not migrate source BOQs. To roll back, close Tawreed,
install a previously verified release package, and retain `~/.tawreed`. Back up
the data directory before rollback when database schema changes are listed in
release notes.
