# Support

Tawreed is maintained by a small team. This page says where to go for what, so
your question reaches the right place.

## Before opening anything

Most problems are already answered in the documentation:

- [User guide](docs/USER-GUIDE.md) — how to take a BOQ through to work packages
- [Installation and updates](docs/INSTALL.md) — downloads, checksums, and the
  security warnings you will see on an unsigned build
- [Troubleshooting and operations](docs/OPERATIONS.md) — logs, output folders,
  and recovery when a generation fails
- [Privacy and local data](docs/PRIVACY.md) — what stays on your machine and
  what is sent to an AI provider

## Reporting a problem

Open a [bug report](https://github.com/kareem-sf/tawreed/issues/new?template=bug_report.yml).

Please include the Tawreed version, your operating system, and which AI provider
you had connected. If a generation failed, the log file named in
[OPERATIONS.md](docs/OPERATIONS.md) is usually what makes the difference between
a guess and a fix.

**Do not attach a real BOQ workbook.** It is commercially sensitive, and it is
almost never needed — a description of the rows that misbehaved, or a small file
with the numbers changed, is enough.

**Never paste an API key**, including in a screenshot. If you already have,
revoke it with your provider first.

## Asking a question or suggesting an idea

Use [Discussions](https://github.com/kareem-sf/tawreed/discussions) for questions
about how something works, and for feature ideas. Ideas that gather support there
are the ones most likely to get built.

## Security

Do not report security problems in a public issue. Follow
[SECURITY.md](SECURITY.md), which explains how to disclose privately.

## What to expect

This is not a commercial support contract. Issues are triaged as time allows,
and a clear, reproducible report is handled far faster than a vague one.
