# Privacy

## Local Processing

Tawreed performs these operations on the device:

- Excel and PDF parsing
- English and Arabic OCR
- deterministic classification and validation
- workbook generation
- project-specific classification memory, settings, history, and diagnostic
  logging

Runtime data is stored under `~/.tawreed`. Generated workbooks may contain the
full commercial content of the source BOQ and should be protected accordingly.

## Optional AI Processing

AI enhancement is optional. After local extraction, Tawreed shows the selected
provider and asks for explicit per-file approval. Only after approval may item
identifiers, descriptions, units, quantities, grounded project candidates, and
relevant comments be sent to that provider:

- Anthropic receives requests through `api.anthropic.com`. Its key is stored in
  the operating-system credential manager, as every provider key is. If that
  store is unavailable the key is not saved at all: Tawreed reports the failure
  rather than writing a key to disk. A key left in `~/.tawreed/.env` by a build
  before this rule is read once, moved into the credential manager, and cleared
  from the file.
- Codex receives prompts through the official local Codex CLI and the user's
  ChatGPT authentication. Tawreed does not read Codex OAuth tokens. Each job is
  ephemeral, schema-constrained, read-only, cancellable, and runs in a fresh
  empty working directory without loading repository rules or user
  configuration.
- Google Gemini receives requests through Gemini's official OpenAI-compatible
  endpoint (`generativelanguage.googleapis.com`). Its key is stored in the
  operating-system credential manager.
- xAI Grok receives requests through Grok's official OpenAI-compatible
  endpoint (`api.x.ai`). Its key is stored in the operating-system credential
  manager.
- A user-supplied "Other service" (any OpenAI-compatible HTTPS endpoint) may
  also be configured. Its key is stored in the operating-system credential
  manager. Data sent to a self-configured service is only as private as that
  service's own policy — review it before enabling.

Regardless of provider, only item identifiers, descriptions, units,
quantities, grounded project candidates, and relevant comments are ever sent,
and only after per-file approval.

Do not enable an external AI provider when project policy prohibits that data
from leaving the device. Offline deterministic classification remains
available without a provider.

## Update Checks

At every startup and when requested from About, Tawreed makes an unauthenticated
HTTPS request to GitHub's latest-release API for `kareem-sf/tawreed`. GitHub may
observe standard request metadata such as IP address, time, application user
agent, and network headers. Tawreed sends no BOQ content, filenames, project
metadata, history, API keys, or persistent application identifier.

## Logs and History

`history.sqlite` stores input filenames and hashes, detected project names,
revision and output paths, item/package counts, source type, OCR use, provider
and model, AI use, agent event traces, and the count of locally applied memory
rules. Approved project/package mappings are also stored locally in this
database. `app.log` contains operational messages and may include filenames,
project names, generated paths, and provider error summaries. The log rotates
to `app.log.1` once it exceeds 10 MB rather than being cleared, so a report
made shortly after that point still has recent history to include.

Delete `~/.tawreed` to remove Tawreed's local settings, history, logs, managed
Codex binary, classification memory, and generated output. Back up required
workbooks first. Remove a saved Anthropic key from Settings before deleting
that directory because native credentials are held by the operating system.
