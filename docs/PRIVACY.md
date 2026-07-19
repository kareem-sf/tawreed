# Privacy

## Local Processing

Tawreed performs these operations on the device:

- Excel and PDF parsing
- English and Arabic OCR
- deterministic classification and validation
- workbook generation
- settings, history, and diagnostic logging

Runtime data is stored under `~/.tawreed`. Generated workbooks may contain the
full commercial content of the source BOQ and should be protected accordingly.

## Optional AI Processing

AI enhancement is optional. When enabled, item identifiers, descriptions,
units, quantities, grounded project candidates, and relevant comments may be
sent to the selected provider:

- Anthropic receives requests through `api.anthropic.com` using the key saved
  under `~/.tawreed/.env`.
- Codex receives prompts through the official local Codex CLI and the user's
  ChatGPT authentication. Tawreed does not read Codex OAuth tokens.

Do not enable an external AI provider when project policy prohibits that data
from leaving the device. Offline deterministic classification remains
available without a provider.

## Update Checks

At every startup and when requested from About, Tawreed makes an unauthenticated
HTTPS request to GitHub's latest-release API for `sfkareem/tawreed`. GitHub may
observe standard request metadata such as IP address, time, application user
agent, and network headers. Tawreed sends no BOQ content, filenames, project
metadata, history, API keys, or persistent application identifier.

## Logs and History

`history.sqlite` stores input filenames and hashes, detected project names,
revision and output paths, item/package counts, source type, OCR use, and AI
use. `app.log` contains operational messages and may include filenames, project
names, generated paths, and provider error summaries.

Delete `~/.tawreed` to remove Tawreed's local settings, history, logs, managed
Codex binary, and generated output. Back up required workbooks first.
