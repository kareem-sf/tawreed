# Tawreed Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working local-first platform foundation with one visible Tawreed executable, a verified managed runtime under `~/.tawreed`, text-first project state, a local Tawreed Agent Kernel, a Codex SDK bridge, and the approved Adaptive Agent Workspace.

**Architecture:** Keep React as presentation and Tauri/Rust as the privileged host. Add a long-lived TypeScript/Node agent kernel reached through private JSON-RPC over standard I/O; Rust manages its runtime, storage, lifecycle, and secrets boundary while provider bridges stay replaceable behind one contract.

**Tech Stack:** React 19, TypeScript 5.9, Vite 6, Vitest 4, Zod 3, Tauri 2, Rust 2021, Node.js 24 runtime pack, `@openai/codex-sdk` 0.149.1, esbuild 0.28.2, reqwest, serde, SHA-256, Ed25519 signatures, GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-08-25-tawreed-agentic-redesign-design.md`

## Global Constraints

- Windows 10/11 x64 is the first release target; all new contracts and paths must remain portable to macOS and Linux.
- The user handles one visible artifact (`Tawreed.exe` on Windows); managed components live under `~/.tawreed`.
- Node.js 24 is the repository and runtime-pack baseline; Rust code remains compatible with the repository floor of Rust 1.88.
- Tawreed-owned settings, connections, project state, rules, events, and checkpoints are human-readable JSON or JSONL.
- Tawreed must not use an operating-system credential manager or add an encryption layer; `connections.json` stores Tawreed-owned credentials as plaintext and never crosses into the webview.
- Provider-owned Codex authentication must use `CODEX_HOME=~/.tawreed/providers/codex` and `cli_auth_credentials_store="file"`.
- Runtime downloads come from versioned GitHub Release assets, never from a repository branch, and must pass signature, SHA-256, size, and safe-extraction checks before activation.
- The Agent Kernel opens no public listening port. Structured protocol messages use stdout; diagnostics use stderr.
- Preserve the existing BOQ workflow during this subproject. Package Architecture and Material Takeoff behavior belong to later plans.
- No source BOQ value may be changed by foundation migrations or project persistence.
- Every task uses TDD, passes targeted checks, and ends in a focused commit.

---

## Target File Structure

### Shared contracts

- `shared/platform.ts` — Zod schemas and inferred TypeScript types for bootstrap, connections, projects, agent state, and user-visible summaries. It must never contain secret fields.
- `tests/platform-contracts.test.ts` — strict parsing and redaction contract tests.

### Rust host

- `src-tauri/src/storage/mod.rs` — exports the text-store modules.
- `src-tauri/src/storage/layout.rs` — resolves and creates the `~/.tawreed` directory topology.
- `src-tauri/src/storage/json.rs` — atomic pretty-JSON writes and durable JSONL appends.
- `src-tauri/src/storage/connections.rs` — plaintext credential records and redacted summaries.
- `src-tauri/src/storage/history.rs` — JSONL run history used by existing commands.
- `src-tauri/src/storage/migration.rs` — idempotent import from `.env` and legacy SQLite state.
- `src-tauri/src/storage/projects.rs` — project metadata, listing, and checkpoints.
- `src-tauri/src/runtime/mod.rs` — exports runtime management.
- `src-tauri/src/runtime/manifest.rs` — manifest schemas, signature verification, and target selection.
- `src-tauri/src/runtime/installer.rs` — resumable download, safe extraction, staging, activation, and rollback.
- `src-tauri/src/runtime/manager.rs` — serializes bootstrap work and reports state/progress.
- `src-tauri/src/agent/mod.rs` — exports local-agent integration.
- `src-tauri/src/agent/protocol.rs` — Rust JSON-RPC envelopes and normalized events.
- `src-tauri/src/agent/supervisor.rs` — starts, initializes, monitors, and stops the Agent Kernel.
- `src-tauri/src/platform_commands.rs` — narrow Tauri commands for bootstrap, projects, connections, and agent requests.

### Agent Kernel

- `agent-kernel/src/index.ts` — newline-delimited JSON-RPC process entrypoint and health-check CLI.
- `agent-kernel/src/protocol.ts` — strict protocol schemas shared inside the kernel.
- `agent-kernel/src/kernel.ts` — request dispatcher and provider registry.
- `agent-kernel/src/providers/types.ts` — provider-neutral bridge interface.
- `agent-kernel/src/providers/codex.ts` — Codex SDK implementation.
- `agent-kernel/src/project-context.ts` — scoped project workspace and checkpoint paths.
- `tests/agent-protocol.test.ts` — protocol and dispatcher tests with a fake provider.
- `tests/codex-bridge.test.ts` — Codex construction, option mapping, streaming normalization, and resume tests using an injected fake SDK client.

### React application

- `src/features/bootstrap/types.ts` — bootstrap reducer actions and state aliases from shared contracts.
- `src/features/bootstrap/reducer.ts` — deterministic first-run state transitions.
- `src/features/bootstrap/useRuntimeBootstrap.ts` — Tauri command/event orchestration.
- `src/features/bootstrap/BootstrapScreen.tsx` — nontechnical first-run progress and retry UI.
- `src/features/connections/useConnections.ts` — redacted connection CRUD and health checks.
- `src/features/connections/ConnectionsCenter.tsx` — Codex ChatGPT/API-key setup with one-time plaintext warning.
- `src/features/workspace/ProjectLauncher.tsx` — create/open/import entry surface.
- `src/features/workspace/AdaptiveWorkspace.tsx` — selected B2 shell.
- `src/features/workspace/AgentRail.tsx` — compact/expanded agent status and conversation rail.
- `src/features/workspace/WorkspaceTabs.tsx` — Sources, Packages, Material Takeoff, Decisions, and Outputs navigation.
- `tests/bootstrap-reducer.test.ts` and `tests/workspace-reducer.test.ts` — pure UI-state tests.

### Build and release

- `scripts/build-agent-runtime.mjs` — bundles the kernel and assembles the platform runtime pack.
- `scripts/generate-runtime-manifest.mjs` — hashes and signs runtime assets.
- `scripts/verify-runtime-assets.mjs` — validates release asset topology and manifest integrity.
- `.github/workflows/ci.yml` — builds and smoke-tests the Windows agent runtime.
- `.github/workflows/release.yml` — publishes the runtime pack, signed manifest, signature, and checksums before the release becomes public.

---

### Task 1: Establish strict cross-layer platform contracts

**Files:**
- Create: `shared/platform.ts`
- Create: `tests/platform-contracts.test.ts`

**Interfaces:**
- Consumes: existing `zod` dependency and Vitest test runner.
- Produces: `ProviderId`, `RuntimeBootstrapStatus`, `ConnectionSummary`, `ProjectSummary`, and their strict Zod schemas for Tasks 3, 5, 8, and 12.

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  connectionSummarySchema,
  projectSummarySchema,
  runtimeBootstrapStatusSchema,
} from '../shared/platform';

describe('platform contracts', () => {
  it('accepts a bounded runtime progress state', () => {
    expect(runtimeBootstrapStatusSchema.parse({
      phase: 'downloading', progress: 42, component: 'agent-kernel',
      version: '1.0.0', errorCode: null, recoverable: false,
    }).progress).toBe(42);
    expect(() => runtimeBootstrapStatusSchema.parse({
      phase: 'downloading', progress: 101, component: null,
      version: null, errorCode: null, recoverable: false,
    })).toThrow();
  });

  it('rejects secrets from renderer-facing connection summaries', () => {
    expect(() => connectionSummarySchema.parse({
      provider: 'codex', configured: true, authenticated: true,
      authKind: 'api_key', displayName: 'Codex', apiKey: 'secret',
    })).toThrow();
  });

  it('accepts a safe project summary', () => {
    expect(projectSummarySchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Project Atlas', status: 'active', updatedAtMs: 1,
    }).name).toBe('Project Atlas');
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npm test -- tests/platform-contracts.test.ts`

Expected: FAIL because `shared/platform.ts` does not exist.

- [ ] **Step 3: Implement strict schemas and inferred types**

```ts
import { z } from 'zod';

export const providerIdSchema = z.enum(['codex', 'claude', 'gemini', 'compatible']);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const runtimePhaseSchema = z.enum([
  'checking', 'downloading', 'verifying', 'activating', 'ready', 'error',
]);
export const runtimeBootstrapStatusSchema = z.object({
  phase: runtimePhaseSchema,
  progress: z.number().min(0).max(100).nullable(),
  component: z.string().min(1).max(80).nullable(),
  version: z.string().min(1).max(40).nullable(),
  errorCode: z.string().min(1).max(80).nullable(),
  recoverable: z.boolean(),
}).strict();
export type RuntimeBootstrapStatus = z.infer<typeof runtimeBootstrapStatusSchema>;

export const connectionSummarySchema = z.object({
  provider: providerIdSchema,
  configured: z.boolean(),
  authenticated: z.boolean(),
  authKind: z.enum(['api_key', 'provider_file']).nullable(),
  displayName: z.string().min(1).max(80),
}).strict();
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  status: z.enum(['active', 'archived', 'needs_attention']),
  updatedAtMs: z.number().int().nonnegative(),
}).strict();
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
```

- [ ] **Step 4: Run targeted tests and type checking**

Run: `npm test -- tests/platform-contracts.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add shared/platform.ts tests/platform-contracts.test.ts
git commit -m "feat(platform): define foundation contracts"
```

### Task 2: Introduce the durable `~/.tawreed` layout and text primitives

**Files:**
- Create: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/storage/layout.rs`
- Create: `src-tauri/src/storage/json.rs`
- Modify: `src-tauri/src/main.rs:3-9`
- Modify: `src-tauri/Cargo.toml:13-33`

**Interfaces:**
- Consumes: `store::replace_file` semantics from the current host.
- Produces: `DataLayout::discover()`, `DataLayout::from_root(PathBuf)`, `atomic_write_json<T>()`, and `append_jsonl<T>()` for every later storage/runtime task.

- [ ] **Step 1: Add `tempfile` for isolated Rust tests**

```toml
[dev-dependencies]
tempfile = "3"
```

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS with the updated lockfile.

- [ ] **Step 2: Write failing layout and atomic-write tests**

```rust
#[test]
fn creates_the_complete_platform_layout() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::from_root(root.path().join(".tawreed"));
    layout.ensure().unwrap();
    for path in [&layout.runtime, &layout.assets, &layout.projects,
                 &layout.rules, &layout.cache, &layout.staging, &layout.logs] {
        assert!(path.is_dir(), "missing {}", path.display());
    }
}

#[test]
fn json_write_replaces_the_complete_document() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("settings.json");
    atomic_write_json(&path, &serde_json::json!({"value": 1})).unwrap();
    atomic_write_json(&path, &serde_json::json!({"value": 2})).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(value["value"], 2);
}
```

- [ ] **Step 3: Run the Rust tests and confirm missing-module failures**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::`

Expected: FAIL because the storage modules do not exist.

- [ ] **Step 4: Implement the directory topology**

```rust
#[derive(Clone, Debug)]
pub struct DataLayout {
    pub root: PathBuf,
    pub runtime: PathBuf,
    pub assets: PathBuf,
    pub projects: PathBuf,
    pub rules: PathBuf,
    pub cache: PathBuf,
    pub staging: PathBuf,
    pub logs: PathBuf,
    pub settings: PathBuf,
    pub connections: PathBuf,
}

impl DataLayout {
    pub fn discover() -> Result<Self, String> {
        let home = dirs::home_dir().ok_or("home_directory_unavailable")?;
        Ok(Self::from_root(home.join(".tawreed")))
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self {
            runtime: root.join("runtime"), assets: root.join("assets"),
            projects: root.join("projects"), rules: root.join("rules"),
            cache: root.join("cache"), staging: root.join("staging"),
            logs: root.join("logs"), settings: root.join("settings.json"),
            connections: root.join("connections.json"), root,
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        for path in [&self.root, &self.runtime, &self.assets, &self.projects,
                     &self.rules, &self.cache, &self.staging, &self.logs] {
            std::fs::create_dir_all(path).map_err(|e| format!("create {}: {e}", path.display()))?;
        }
        Ok(())
    }
}
```

- [ ] **Step 5: Implement durable JSON and JSONL writes**

```rust
pub fn atomic_write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("text_store_parent_missing")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create parent: {e}"))?;
    let tmp = parent.join(format!(".{}.{}.tmp", path.file_name().unwrap().to_string_lossy(), std::process::id()));
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| format!("serialize json: {e}"))?;
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create temporary json: {e}"))?;
    use std::io::Write;
    file.write_all(&bytes).and_then(|_| file.write_all(b"\n")).and_then(|_| file.sync_all())
        .map_err(|e| format!("write temporary json: {e}"))?;
    crate::store::replace_file(&tmp, path).map_err(|e| format!("replace json: {e}"))
}

pub fn append_jsonl<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)
        .map_err(|e| format!("open jsonl: {e}"))?;
    serde_json::to_writer(&mut file, value).map_err(|e| format!("serialize jsonl: {e}"))?;
    use std::io::Write;
    file.write_all(b"\n").and_then(|_| file.sync_data()).map_err(|e| format!("append jsonl: {e}"))
}
```

- [ ] **Step 6: Export the modules and rerun Rust checks**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all`

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::`

Expected: PASS.

- [ ] **Step 7: Commit the storage primitives**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/src/storage
git commit -m "feat(platform): add text-first storage primitives"
```

### Task 3: Replace Tawreed-owned credential storage with plaintext connections

**Files:**
- Create: `src-tauri/src/storage/connections.rs`
- Create: `src-tauri/src/platform_commands.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/store.rs:1-12,310-598`
- Modify: `src-tauri/src/main.rs:3-54`
- Modify: `src-tauri/Cargo.toml:13-33`

**Interfaces:**
- Consumes: `DataLayout`, `atomic_write_json()`, and existing provider commands.
- Produces: `ConnectionStore::{load, upsert_api_key, upsert_provider_file, secret, summaries, remove}` plus Tauri commands `list_connections`, `save_api_key_connection`, and `delete_connection`.

- [ ] **Step 1: Write failing plaintext/redaction tests**

```rust
#[test]
fn stores_plaintext_but_never_returns_it_in_a_summary() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::from_root(root.path().join(".tawreed"));
    layout.ensure().unwrap();
    let store = ConnectionStore::new(layout.connections.clone());
    store.upsert_api_key("codex", "sk-test-value").unwrap();
    let raw = std::fs::read_to_string(&layout.connections).unwrap();
    assert!(raw.contains("sk-test-value"));
    let summaries = store.summaries().unwrap();
    assert_eq!(summaries[0].provider, "codex");
    assert!(!serde_json::to_string(&summaries).unwrap().contains("sk-test-value"));
}

#[test]
fn rejects_unknown_provider_identifiers() {
    let root = tempfile::tempdir().unwrap();
    let store = ConnectionStore::new(root.path().join("connections.json"));
    assert_eq!(store.upsert_api_key("../../escape", "x").unwrap_err(), "invalid_provider");
}
```

- [ ] **Step 2: Run the tests and confirm the missing-store failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::connections::`

Expected: FAIL because `ConnectionStore` is undefined.

- [ ] **Step 3: Implement the plaintext connection file**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionAuth {
    ApiKey { value: String },
    ProviderFile { home: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRecord {
    pub provider: String,
    pub enabled: bool,
    pub auth: ConnectionAuth,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ConnectionFile {
    schema_version: u32,
    connections: std::collections::BTreeMap<String, ConnectionRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub provider: String,
    pub configured: bool,
    pub authenticated: bool,
    pub auth_kind: String,
    pub display_name: String,
}
```

Allow only `codex`, `claude`, `gemini`, and `compatible`; trim keys, reject empty or values over 16 KiB, write schema version `1`, and set owner-only Unix permissions after every write.

- [ ] **Step 4: Add redacted Tauri commands**

```rust
#[tauri::command]
pub fn list_connections() -> Result<Vec<ConnectionSummary>, String> {
    let layout = DataLayout::discover()?;
    ConnectionStore::new(layout.connections).summaries()
}

#[tauri::command]
pub fn save_api_key_connection(provider: String, api_key: String) -> Result<(), String> {
    let layout = DataLayout::discover()?;
    ConnectionStore::new(layout.connections).upsert_api_key(&provider, api_key.trim())
}

#[tauri::command]
pub fn delete_connection(provider: String) -> Result<(), String> {
    let layout = DataLayout::discover()?;
    ConnectionStore::new(layout.connections).remove(&provider)
}
```

- [ ] **Step 5: Move existing Anthropic/compatible wrappers to the text store**

Replace `store::api_key()`, `store::compatible_api_key()`, `write_env_key()`, and `write_compatible_api_key()` with compatibility wrappers over `ConnectionStore`; map legacy Anthropic calls to provider id `claude`. Remove the keyring constants, entry helpers, fallback write paths, and `keyring` from `Cargo.toml`. Do not read or delete old OS-keyring entries.

```rust
pub fn api_key() -> Option<String> {
    let layout = crate::storage::layout::DataLayout::discover().ok()?;
    crate::storage::connections::ConnectionStore::new(layout.connections)
        .secret("claude").ok().flatten()
}
```

- [ ] **Step 6: Run compatibility and redaction tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::connections:: store::tests::`

Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 7: Commit plaintext connections**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/src/store.rs src-tauri/src/platform_commands.rs src-tauri/src/storage
git commit -m "feat(platform): store connections as plaintext JSON"
```

### Task 4: Migrate run history to JSONL without mutating legacy data

**Files:**
- Create: `src-tauri/src/storage/history.rs`
- Create: `src-tauri/src/storage/migration.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/store.rs:43-47,213-309`
- Modify: `src-tauri/src/commands.rs:819-1049`

**Interfaces:**
- Consumes: `append_jsonl()`, `atomic_write_json()`, existing `runs` and `classification_memory` SQLite schemas.
- Produces: `HistoryStore::{record, list}`, `migrate_legacy_state(&DataLayout)`, and `migrations.json` marker `legacy-sqlite-v1`.

- [ ] **Step 1: Write a failing legacy-database migration test**

```rust
#[test]
fn imports_legacy_runs_once_and_keeps_the_database() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::from_root(root.path().join(".tawreed"));
    layout.ensure().unwrap();
    let db = layout.root.join("history.sqlite");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch("CREATE TABLE runs (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT NOT NULL, item_count INTEGER NOT NULL, package_count INTEGER NOT NULL, error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL, output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL, llm_used INTEGER NOT NULL); INSERT INTO runs VALUES (1,'2026-01-01','a.xlsx','abc',2,1,0,0,'out.xlsx',10,1);").unwrap();
    migrate_legacy_state(&layout).unwrap();
    migrate_legacy_state(&layout).unwrap();
    assert!(db.exists());
    let lines = std::fs::read_to_string(layout.root.join("history/runs.jsonl")).unwrap();
    assert_eq!(lines.lines().count(), 1);
}
```

- [ ] **Step 2: Run the migration test and confirm failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::migration::`

Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Implement append-only JSONL history**

```rust
#[derive(Clone)]
pub struct HistoryStore { path: PathBuf }

impl HistoryStore {
    pub fn new(path: PathBuf) -> Self { Self { path } }
    pub fn record(&self, value: &serde_json::Value) -> Result<(), String> {
        if !value.is_object() { return Err("invalid_run_record".into()); }
        if let Some(parent) = self.path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        crate::storage::json::append_jsonl(&self.path, value)
    }
    pub fn list(&self) -> Result<Vec<serde_json::Value>, String> {
        let content = std::fs::read_to_string(&self.path).unwrap_or_default();
        content.lines().rev().map(|line| serde_json::from_str(line).map_err(|e| format!("invalid_run_history: {e}"))).collect()
    }
}
```

- [ ] **Step 4: Implement the idempotent SQLite import**

Read legacy rows inside a transaction, serialize each row into the same camel-case shape returned by `list_runs`, write to `history/runs.jsonl`, export classification memory to `rules/legacy-classification-memory.jsonl`, then atomically add `legacy-sqlite-v1` to `migrations.json`. Also read `ANTHROPIC_API_KEY` and `COMPATIBLE_API_KEY` from the legacy `.env`, import non-empty values into provider ids `claude` and `compatible` only when no new record exists, and add marker `legacy-env-v1`. Do not rename, delete, or write to `.env` or `history.sqlite`.

```rust
if migration_state.completed.iter().any(|id| id == "legacy-sqlite-v1") {
    return Ok(());
}
if layout.root.join("history.sqlite").exists() {
    import_runs(&layout.root.join("history.sqlite"), &layout.root.join("history/runs.jsonl"))?;
    import_memory(&layout.root.join("history.sqlite"), &layout.rules.join("legacy-classification-memory.jsonl"))?;
}
migration_state.completed.push("legacy-sqlite-v1".into());
atomic_write_json(&layout.root.join("migrations.json"), &migration_state)
```

- [ ] **Step 5: Route current run commands to JSONL**

Change `record_run` to append to `HistoryStore` and return the record's existing numeric id or timestamp-based fallback. Change `list_runs` to read JSONL. Keep `rusqlite` only in `storage::migration` for one-version compatibility.

- [ ] **Step 6: Run history, command, and formatting checks**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::migration:: storage::history::`

Expected: PASS.

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`

Expected: PASS.

- [ ] **Step 7: Commit the history migration**

```bash
git add src-tauri/src/commands.rs src-tauri/src/store.rs src-tauri/src/storage
git commit -m "feat(platform): migrate history to JSONL"
```

### Task 5: Add project metadata and resumable checkpoints

**Files:**
- Create: `src-tauri/src/storage/projects.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/platform_commands.rs`
- Modify: `src-tauri/src/main.rs:10-53`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `DataLayout`, `atomic_write_json()`, and `append_jsonl()`.
- Produces: `ProjectStore::{create, list, load, save_checkpoint, latest_checkpoint}`, `ProjectSummary`, `Checkpoint`, and Tauri commands `create_project`, `list_projects`, and `latest_project_checkpoint`.

- [ ] **Step 1: Add UUID support and write failing project tests**

Add to `src-tauri/Cargo.toml`:

```toml
uuid = { version = "1", features = ["v4", "serde"] }
```

Add tests:

```rust
#[test]
fn creates_lists_and_reopens_projects() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::from_root(root.path().join(".tawreed"));
    layout.ensure().unwrap();
    let store = ProjectStore::new(layout.projects.clone());
    let created = store.create("Project Atlas").unwrap();
    assert_eq!(store.list().unwrap()[0].id, created.id);
    assert_eq!(store.load(&created.id).unwrap().name, "Project Atlas");
}

#[test]
fn returns_only_the_latest_valid_checkpoint() {
    let root = tempfile::tempdir().unwrap();
    let store = ProjectStore::new(root.path().join("projects"));
    let project = store.create("Atlas").unwrap();
    store.save_checkpoint(&project.id, &Checkpoint::new("run-1", "bootstrap", 1)).unwrap();
    store.save_checkpoint(&project.id, &Checkpoint::new("run-1", "agent_ready", 2)).unwrap();
    assert_eq!(store.latest_checkpoint(&project.id).unwrap().unwrap().stage, "agent_ready");
}
```

- [ ] **Step 2: Run the tests and confirm missing project-store failures**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::projects::`

Expected: FAIL because `ProjectStore` is undefined.

- [ ] **Step 3: Implement project and checkpoint types**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub schema_version: u32,
    pub run_id: String,
    pub stage: String,
    pub sequence: u64,
    pub created_at_ms: u64,
    pub payload: serde_json::Value,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl Checkpoint {
    pub fn new(run_id: &str, stage: &str, sequence: u64) -> Self {
        Self {
            schema_version: 1,
            run_id: run_id.to_owned(),
            stage: stage.to_owned(),
            sequence,
            created_at_ms: now_ms(),
            payload: serde_json::json!({}),
        }
    }
}
```

Validate project ids as UUIDs, trim names, limit names to 160 characters, and use `<projects>/<uuid>/project.json` plus `<projects>/<uuid>/checkpoints/<sequence>.json`. Reject symlinks and paths outside the project root.

- [ ] **Step 4: Implement project commands without exposing filesystem paths**

```rust
#[tauri::command]
pub fn create_project(name: String) -> Result<ProjectSummary, String> {
    let layout = DataLayout::discover()?;
    ProjectStore::new(layout.projects).create(&name)
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectSummary>, String> {
    let layout = DataLayout::discover()?;
    ProjectStore::new(layout.projects).list()
}
```

- [ ] **Step 5: Register commands and run Rust validation**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all`

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::projects::`

Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 6: Commit project persistence**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/src/platform_commands.rs src-tauri/src/storage
git commit -m "feat(platform): add project checkpoints"
```

### Task 6: Verify signed runtime manifests and select platform assets

**Files:**
- Create: `src-tauri/src/runtime/mod.rs`
- Create: `src-tauri/src/runtime/manifest.rs`
- Create: `src-tauri/runtime-updater.pub`
- Create: `scripts/generate-runtime-keypair.mjs`
- Modify: `src-tauri/src/main.rs:3-9`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: app version, OS/architecture target, embedded public key, SHA-256 utilities.
- Produces: `RuntimeManifest`, `RuntimeAsset`, `RuntimeTarget`, `verify_manifest()`, and `select_asset()` for Task 7.

- [ ] **Step 1: Add signature dependencies**

```toml
ed25519-dalek = "2"
```

Use the existing `base64`, `semver`, `serde`, `serde_json`, and `sha2` dependencies.

- [ ] **Step 2: Write failing deterministic signature tests**

```rust
#[test]
fn verifies_a_signed_manifest_and_selects_windows_x64() {
    use ed25519_dalek::{Signer, SigningKey};
    let signing = SigningKey::from_bytes(&[7_u8; 32]);
    let bytes = br#"{"schemaVersion":1,"appVersion":"0.5.6","assets":{"windows-x86_64":{"version":"1.0.0","url":"https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/tawreed-runtime-windows-x64.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1024,"archive":"zip","entrypoint":"agent/node.exe"}}}"#;
    let signature = signing.sign(bytes);
    let manifest = verify_manifest(bytes, &signature.to_bytes(), &signing.verifying_key().to_bytes()).unwrap();
    assert_eq!(select_asset(&manifest, RuntimeTarget::WindowsX86_64).unwrap().version, "1.0.0");
}

#[test]
fn rejects_untrusted_hosts_and_invalid_entrypoints() {
    let asset = RuntimeAsset {
        version: "1.0.0".into(),
        url: "https://evil.example/runtime.zip".into(),
        sha256: "a".repeat(64),
        size: 1024,
        archive: "zip".into(),
        entrypoint: "../escape".into(),
    };
    assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");
}
```

- [ ] **Step 3: Run tests and confirm missing manifest failures**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime::manifest::`

Expected: FAIL because the runtime manifest module does not exist.

- [ ] **Step 4: Implement strict manifest models**

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeManifest {
    pub schema_version: u32,
    pub app_version: String,
    pub assets: std::collections::BTreeMap<String, RuntimeAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeAsset {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub archive: String,
    pub entrypoint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeTarget { WindowsX86_64, LinuxX86_64, DarwinX86_64, DarwinAarch64 }

impl RuntimeTarget {
    pub fn key(self) -> &'static str {
        match self {
            Self::WindowsX86_64 => "windows-x86_64",
            Self::LinuxX86_64 => "linux-x86_64",
            Self::DarwinX86_64 => "darwin-x86_64",
            Self::DarwinAarch64 => "darwin-aarch64",
        }
    }
}
```

Require `schemaVersion == 1`, `appVersion` equal to the running Tawreed version, canonical stable SemVer, HTTPS GitHub release URLs under `github.com/kareem-sf/tawreed/releases/download/`, lowercase 64-character SHA-256, size between 1 byte and 1 GiB, archive `zip`, and a clean relative entrypoint. Decode the detached Base64 signature to exactly 64 bytes and the embedded public key to exactly 32 bytes before calling `verify_manifest`.

- [ ] **Step 5: Implement Ed25519 verification before JSON parsing**

```rust
pub fn verify_manifest(bytes: &[u8], signature: &[u8; 64], public_key: &[u8; 32]) -> Result<RuntimeManifest, String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| "invalid_runtime_key")?;
    key.verify(bytes, &Signature::from_bytes(signature)).map_err(|_| "invalid_runtime_signature")?;
    let manifest: RuntimeManifest = serde_json::from_slice(bytes).map_err(|_| "invalid_runtime_manifest")?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}
```

- [ ] **Step 6: Generate and commit only the production public key**

Implement `scripts/generate-runtime-keypair.mjs` so it requires an output directory outside the repository, writes an unencrypted PKCS#8 private key there with owner-only permissions, exports the Ed25519 public JWK, decodes its `x` member to the raw 32-byte key expected by Rust, and writes only that key in Base64 to `src-tauri/runtime-updater.pub`.

```js
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicJwk = publicKey.export({ format: 'jwk' });
const rawPublic = Buffer.from(publicJwk.x, 'base64url');
if (rawPublic.length !== 32) throw new Error('Unexpected Ed25519 public key length');
await writeFile(join(outDir, 'runtime-private.pem'), privatePem, { mode: 0o600 });
await writeFile('src-tauri/runtime-updater.pub', `${rawPublic.toString('base64')}\n`);
```

Run: `node scripts/generate-runtime-keypair.mjs "$env:TEMP\tawreed-runtime-key"` on Windows, or `node scripts/generate-runtime-keypair.mjs "$TMPDIR/tawreed-runtime-key"` on Unix.

Store the generated private key as the protected GitHub Actions secret `TAWREED_RUNTIME_SIGNING_KEY`; never print or commit it.

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime::manifest::`

Expected: PASS.

- [ ] **Step 7: Commit manifest verification**

```bash
git add scripts/generate-runtime-keypair.mjs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/runtime-updater.pub src-tauri/src/main.rs src-tauri/src/runtime
git commit -m "feat(runtime): verify signed manifests"
```

### Task 7: Install, resume, activate, and roll back managed runtimes

**Files:**
- Create: `src-tauri/src/runtime/installer.rs`
- Create: `src-tauri/src/runtime/manager.rs`
- Modify: `src-tauri/src/runtime/mod.rs`
- Modify: `src-tauri/src/storage/layout.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: verified `RuntimeAsset`, `DataLayout`, and reqwest.
- Produces: `RuntimeInstaller::ensure(asset)`, `RuntimeManager::{status, start, retry, active_entrypoint, rollback}`, and `RuntimeBootstrapStatus` serialized in the exact shared-contract shape.

- [ ] **Step 1: Enable required Tokio features**

```toml
tokio = { version = "1", features = ["macros", "time", "fs", "io-util", "sync", "process"] }
async-trait = "0.1"
```

- [ ] **Step 2: Write failing activation and rollback tests using a fake source**

```rust
#[tokio::test]
async fn promotes_only_a_verified_healthy_runtime() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::from_root(root.path().join(".tawreed"));
    layout.ensure().unwrap();
    let source = FakeRuntimeSource::zip_with_entry("agent/node.exe", b"healthy");
    let installer = RuntimeInstaller::new(layout.clone(), source);
    let active = installer.ensure(&asset_for(&source)).await.unwrap();
    assert!(active.join("agent/node.exe").exists());
    assert_eq!(read_pointer(&layout.runtime.join("current.json")).unwrap().version, "1.0.0");
}

#[tokio::test]
async fn retains_previous_runtime_when_health_check_fails() {
    let fixture = RuntimeFixture::with_active("0.9.0");
    fixture.source.set_health(false);
    assert!(fixture.installer.ensure(&fixture.asset("1.0.0")).await.is_err());
    assert_eq!(fixture.current_version(), "0.9.0");
}
```

Define the source seam used by those fixtures:

```rust
#[async_trait::async_trait]
pub trait RuntimeSource: Send + Sync {
    async fn download(
        &self,
        asset: &RuntimeAsset,
        destination: &Path,
        resume_from: u64,
        progress: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String>;
}
```

Define the renderer-compatible status type:

```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapStatus {
    pub phase: String,
    pub progress: Option<f64>,
    pub component: Option<String>,
    pub version: Option<String>,
    pub error_code: Option<String>,
    pub recoverable: bool,
}
```

`HttpRuntimeSource` implements the production Range-request behavior. The test-only `FakeRuntimeSource` writes a fixture ZIP beginning at `resume_from` and records requested offsets. `RuntimeFixture` creates a temporary `DataLayout`, active pointer, fake source, and installer; `asset_for()` computes the fixture bytes' exact size and SHA-256.

- [ ] **Step 3: Run tests and confirm missing installer failures**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime::installer::`

Expected: FAIL because `RuntimeInstaller` is undefined.

- [ ] **Step 4: Implement resumable `.part` downloads**

Use `<staging>/<target>-<version>.zip.part`, send `Range: bytes=<existing>-` when a partial file exists, require `206 Partial Content` for resumed downloads, restart from zero if the server returns `200`, cap bytes at the manifest size, sync the file, and compare exact size and SHA-256 before extraction.

```rust
let existing = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
let mut request = client.get(&asset.url);
if existing > 0 { request = request.header(reqwest::header::RANGE, format!("bytes={existing}-")); }
let response = request.send().await.map_err(map_download_error)?;
let append = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
let mut file = tokio::fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(&part).await.map_err(io_error)?;
```

- [ ] **Step 5: Implement safe bounded ZIP extraction**

Reject absolute paths, `..`, symlinks, more than 10,000 entries, and expanded content over 2 GiB. Extract into `<staging>/runtime-<version>.tmp`, never directly into the active directory.

```rust
for index in 0..archive.len() {
    let mut entry = archive.by_index(index).map_err(zip_error)?;
    let relative = entry.enclosed_name().ok_or("unsafe_runtime_archive")?.to_owned();
    if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
        return Err("unsafe_runtime_archive".into());
    }
    expanded = expanded.checked_add(entry.size()).ok_or("runtime_archive_too_large")?;
    if expanded > 2 * 1024 * 1024 * 1024 { return Err("runtime_archive_too_large".into()); }
    extract_entry(&mut entry, &staging_root.join(relative))?;
}
```

- [ ] **Step 6: Implement health check and atomic pointer activation**

Run the runtime entrypoint with `--health-check`, require exit code `0` and a single JSON line `{"status":"ok","protocolVersion":1}`, rename the staged directory to `<runtime>/versions/<version>`, write `previous.json`, then atomically replace `current.json`.

```rust
#[derive(Serialize, Deserialize)]
struct RuntimePointer { version: String, target: String, entrypoint: String }
```

- [ ] **Step 7: Implement serialized manager state and progress callbacks**

`RuntimeManager` owns a Tokio mutex so duplicate starts share one installation. Progress updates move only through `checking -> downloading -> verifying -> activating -> ready`; errors include a stable code and `recoverable` flag.

```rust
pub struct RuntimeManager {
    installer: RuntimeInstaller<HttpRuntimeSource>,
    status: tokio::sync::RwLock<RuntimeBootstrapStatus>,
    install_lock: tokio::sync::Mutex<()>,
}

impl RuntimeManager {
    pub async fn status(&self) -> RuntimeBootstrapStatus { self.status.read().await.clone() }
}
```

- [ ] **Step 8: Run runtime tests and Rust quality gates**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime::`

Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 9: Commit runtime installation**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/runtime src-tauri/src/storage/layout.rs
git commit -m "feat(runtime): install managed agent packs"
```

### Task 8: Expose bootstrap state and build the first-run experience

**Files:**
- Create: `src/features/bootstrap/types.ts`
- Create: `src/features/bootstrap/reducer.ts`
- Create: `src/features/bootstrap/useRuntimeBootstrap.ts`
- Create: `src/features/bootstrap/BootstrapScreen.tsx`
- Create: `tests/bootstrap-reducer.test.ts`
- Create: `tests/bootstrap-i18n.test.ts`
- Modify: `src-tauri/src/platform_commands.rs`
- Modify: `src-tauri/src/main.rs:10-54`
- Modify: `src/bridge.ts:1-80`
- Modify: `src/app/types.ts`
- Modify: `src/app/useAppConfiguration.ts`
- Modify: `src/App.tsx:1-66`
- Modify: `src/i18n/resources/en.ts`
- Modify: `src/i18n/resources/ar.ts`

**Interfaces:**
- Consumes: `RuntimeManager`, shared `RuntimeBootstrapStatus`, Tauri events.
- Produces: commands `runtime_status`, `runtime_start`, `runtime_retry`; event `runtime://progress`; hook `useRuntimeBootstrap()`; and `BootstrapScreen`.

- [ ] **Step 1: Write failing reducer tests**

```ts
import { describe, expect, it } from 'vitest';
import { bootstrapReducer, initialBootstrapState } from '../src/features/bootstrap/reducer';

describe('bootstrap reducer', () => {
  it('moves through progress and ready states', () => {
    const downloading = bootstrapReducer(initialBootstrapState, {
      type: 'status', status: { phase: 'downloading', progress: 25, component: 'agent-kernel', version: '1.0.0', errorCode: null, recoverable: false },
    });
    expect(downloading.status.progress).toBe(25);
    const ready = bootstrapReducer(downloading, {
      type: 'status', status: { phase: 'ready', progress: 100, component: null, version: '1.0.0', errorCode: null, recoverable: false },
    });
    expect(ready.status.phase).toBe('ready');
  });
});
```

- [ ] **Step 2: Run the reducer test and confirm failure**

Run: `npm test -- tests/bootstrap-reducer.test.ts`

Expected: FAIL because the reducer does not exist.

- [ ] **Step 3: Implement commands and progress emission**

```rust
#[tauri::command]
pub async fn runtime_start(app: tauri::AppHandle, manager: tauri::State<'_, RuntimeManager>) -> Result<RuntimeBootstrapStatus, String> {
    manager.start(|status| { let _ = app.emit("runtime://progress", &status); }).await
}
```

Annotate the Rust status type with `#[serde(rename_all = "camelCase")]` so fields serialize as `errorCode` and `recoverable`, matching `shared/platform.ts` exactly.

Register `RuntimeManager` in `setup`, add all three commands, and return browser-development status `ready` from `src/bridge.ts` when Tauri is absent.

- [ ] **Step 4: Implement reducer and hook**

`useRuntimeBootstrap()` subscribes before it calls `runtime_start`, validates every payload with `runtimeBootstrapStatusSchema`, removes the listener on unmount, and exposes `{status, retry}`. Invalid events become `error/runtime_protocol_invalid` instead of mutating UI state.

```ts
export function bootstrapReducer(state: BootstrapState, action: BootstrapAction): BootstrapState {
  if (action.type === 'status') return { ...state, status: runtimeBootstrapStatusSchema.parse(action.status) };
  if (action.type === 'protocolError') return {
    ...state,
    status: { phase: 'error', progress: null, component: null, version: null, errorCode: 'runtime_protocol_invalid', recoverable: true },
  };
  return state;
}

useEffect(() => {
  let unlisten: (() => void) | undefined;
  void listen<unknown>('runtime://progress', ({ payload }) => {
    const parsed = runtimeBootstrapStatusSchema.safeParse(payload);
    dispatch(parsed.success ? { type: 'status', status: parsed.data } : { type: 'protocolError' });
  }).then((stop) => { unlisten = stop; return runtimeStart(); })
    .then((status) => dispatch({ type: 'status', status }))
    .catch(() => dispatch({ type: 'protocolError' }));
  return () => unlisten?.();
}, []);
```

- [ ] **Step 5: Implement the nontechnical screen**

Render `Preparing Tawreed for First Use`, one progress bar, current high-level phase, Retry only for recoverable errors, and a collapsed technical-details disclosure. Do not show Node, SDK, ZIP, or provider component choices in the primary copy.

```tsx
export function BootstrapScreen({ status, onRetry }: Props) {
  const { t } = useTranslation();
  return <main aria-busy={status.phase !== 'ready'} className="bootstrap-screen">
    <Logo />
    <h1>{t('preparingTawreed')}</h1>
    <Progress value={status.progress ?? 0} aria-label={t('setupProgress')} />
    <Text aria-live="polite">{t(`runtimePhase.${status.phase}`)}</Text>
    {status.phase === 'error' && status.recoverable && <Button onClick={onRetry}>{t('retry')}</Button>}
    <details><summary>{t('technicalDetails')}</summary><code>{status.errorCode ?? status.component}</code></details>
  </main>;
}
```

- [ ] **Step 6: Route App composition through runtime readiness**

In `App.tsx`, show `BootstrapScreen` before onboarding whenever phase is not `ready`; retain the existing onboarding and workflow branches unchanged after ready.

- [ ] **Step 7: Add complete Arabic and English strings**

Add keys for preparing, downloading, verifying, activating, retry, offline, invalid signature, insufficient disk, and technical details. Extend `tests/update-i18n.test.ts` or create `tests/bootstrap-i18n.test.ts` to assert parity.

- [ ] **Step 8: Run frontend and Rust checks**

Run: `npm test -- tests/bootstrap-reducer.test.ts tests/bootstrap-i18n.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime::`

Expected: PASS.

- [ ] **Step 9: Commit first-run bootstrap UI**

```bash
git add src-tauri/src/main.rs src-tauri/src/platform_commands.rs src/features/bootstrap src/app src/App.tsx src/bridge.ts src/i18n tests/bootstrap-*.test.ts
git commit -m "feat(platform): add first-run runtime setup"
```

### Task 9: Build the local Agent Kernel and strict JSON-RPC protocol

**Files:**
- Create: `agent-kernel/src/index.ts`
- Create: `agent-kernel/src/protocol.ts`
- Create: `agent-kernel/src/kernel.ts`
- Create: `agent-kernel/src/providers/types.ts`
- Create: `agent-kernel/src/project-context.ts`
- Create: `agent-kernel/package.json`
- Create: `agent-kernel/package-lock.json`
- Create: `tests/agent-protocol.test.ts`
- Create: `scripts/build-agent-runtime.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.js`
- Modify: `scripts/verify-architecture.cjs`

**Interfaces:**
- Consumes: Zod, Node.js streams, and shared provider/project identifiers.
- Produces: protocol version `1`, `AgentKernel.dispatch()`, `ProviderBridge`, methods `kernel.initialize`, `kernel.health`, `connections.status`, `sessions.start`, `sessions.resume`, `turns.run`, and `turns.cancel`, plus a bundled `agent-kernel/dist/index.mjs`.

- [ ] **Step 1: Add intentional runtime/build dependencies**

Create `agent-kernel/package.json` with pinned runtime dependencies:

```json
{
  "name": "@tawreed/agent-kernel",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "dependencies": {
    "@openai/codex-sdk": "0.149.1",
    "zod": "3.24.0"
  }
}
```

Run: `npm install --prefix agent-kernel`

Run: `npm install --save-dev esbuild@0.28.2`

Run: `npm run verify:install-scripts`

Expected: PASS. Review any newly introduced lifecycle script before changing the repository allowlist.

- [ ] **Step 2: Write failing protocol and dispatch tests**

```ts
import { describe, expect, it } from 'vitest';
import { AgentKernel } from '../agent-kernel/src/kernel';
import { requestSchema, responseSchema } from '../agent-kernel/src/protocol';

describe('agent protocol', () => {
  it('rejects unknown methods and extra fields', () => {
    expect(() => requestSchema.parse({ jsonrpc: '2.0', id: 1, method: 'shell.run', params: {}, extra: true })).toThrow();
  });

  it('answers health without a provider', async () => {
    const kernel = new AgentKernel({ providers: new Map() });
    const response = await kernel.dispatch(requestSchema.parse({
      jsonrpc: '2.0', id: 1, method: 'kernel.health', params: {},
    }));
    expect(responseSchema.parse(response).result).toEqual({ status: 'ok', protocolVersion: 1 });
  });
});
```

- [ ] **Step 3: Run tests and confirm missing Agent Kernel failures**

Run: `npm test -- tests/agent-protocol.test.ts`

Expected: FAIL because `agent-kernel/src/kernel.ts` does not exist.

- [ ] **Step 4: Define strict protocol envelopes**

```ts
import { z } from 'zod';

export const methodSchema = z.enum([
  'kernel.initialize', 'kernel.health', 'connections.status',
  'sessions.start', 'sessions.resume', 'turns.run', 'turns.cancel',
]);
export const requestSchema = z.object({
  jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]),
  method: methodSchema, params: z.record(z.string(), z.unknown()),
}).strict();
export const responseSchema = z.object({
  jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional(),
}).strict().refine((value) => Number(value.result !== undefined) + Number(value.error !== undefined) === 1);
export const notificationSchema = z.object({
  jsonrpc: z.literal('2.0'), method: z.literal('agent.event'),
  params: z.object({ runId: z.string(), type: z.string(), payload: z.unknown() }).strict(),
}).strict();
```

- [ ] **Step 5: Define the provider-neutral interface**

```ts
export interface ProviderBridge {
  readonly id: 'codex' | 'claude' | 'gemini' | 'compatible';
  health(): Promise<{ authenticated: boolean; detail: string }>;
  startSession(input: { projectId: string; workingDirectory: string }): Promise<{ sessionId: string }>;
  resumeSession(input: { sessionId: string; projectId: string; workingDirectory: string }): Promise<void>;
  runTurn(input: { sessionId: string; prompt: string; outputSchema?: Record<string, unknown> }, emit: (event: AgentEvent) => void): Promise<{ finalResponse: string }>;
  cancel(runId: string): Promise<boolean>;
}

export interface AgentEvent {
  runId: string;
  type: string;
  payload: unknown;
}
```

Implement `project-context.ts` so it accepts only UUID project ids, resolves `<TAWREED_DATA_DIR>/projects/<id>/agent-workspace`, creates that directory, and rejects any resolved path outside `<TAWREED_DATA_DIR>/projects`. Protocol callers pass project ids, never filesystem paths.

- [ ] **Step 6: Implement dispatch and the newline process loop**

`index.ts` reads one line at a time from stdin, parses it, writes exactly one response line to stdout, and writes diagnostic text only to stderr. `--health-check` prints `{"status":"ok","protocolVersion":1}` and exits without loading provider credentials.

```ts
const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of reader) {
  const request = requestSchema.parse(JSON.parse(line));
  process.stdout.write(`${JSON.stringify(await kernel.dispatch(request))}\n`);
}
```

- [ ] **Step 7: Add the deterministic build script and repository checks**

`scripts/build-agent-runtime.mjs` invokes esbuild with `platform: 'node'`, `target: 'node24'`, `format: 'esm'`, `bundle: true`, `packages: 'external'`, and output `agent-kernel/dist/index.mjs`. Add `agent-kernel` to `tsconfig.json`, ESLint source globs, and architecture reachability roots.

Add scripts:

```json
"agent:build": "node scripts/build-agent-runtime.mjs",
"agent:health": "node agent-kernel/dist/index.mjs --health-check"
```

- [ ] **Step 8: Run protocol, build, and health checks**

Run: `npm test -- tests/agent-protocol.test.ts`

Expected: PASS.

Run: `npm run agent:build`

Expected: creates `agent-kernel/dist/index.mjs`.

Run: `npm run agent:health`

Expected stdout: `{"status":"ok","protocolVersion":1}`.

- [ ] **Step 9: Commit the Agent Kernel skeleton**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.js agent-kernel scripts/build-agent-runtime.mjs scripts/verify-architecture.cjs tests/agent-protocol.test.ts
git commit -m "feat(agent): add local kernel protocol"
```

### Task 10: Supervise the Agent Kernel from Rust

**Files:**
- Create: `src-tauri/src/agent/mod.rs`
- Create: `src-tauri/src/agent/protocol.rs`
- Create: `src-tauri/src/agent/supervisor.rs`
- Modify: `src-tauri/src/main.rs:3-54`
- Modify: `src-tauri/src/platform_commands.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: active runtime pointer, `DataLayout`, kernel protocol version `1`.
- Produces: `AgentSupervisor::{new, start, request, cancel, stop, health}`, Tauri commands `agent_health`, `agent_request`, `agent_cancel`, and Tauri event `agent://event`.

- [ ] **Step 1: Write failing protocol-router tests**

```rust
#[tokio::test]
async fn routes_responses_to_the_matching_request() {
    let router = JsonRpcRouter::default();
    let waiting = router.register(7).unwrap();
    router.accept_line(r#"{"jsonrpc":"2.0","id":7,"result":{"status":"ok"}}"#).unwrap();
    assert_eq!(waiting.await.unwrap()["status"], "ok");
}

#[test]
fn rejects_stdout_that_is_not_json_rpc() {
    let router = JsonRpcRouter::default();
    assert_eq!(router.accept_line("debug text").unwrap_err(), "invalid_agent_protocol");
}
```

- [ ] **Step 2: Run tests and confirm missing supervisor failures**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::`

Expected: FAIL because the agent modules do not exist.

- [ ] **Step 3: Mirror JSON-RPC envelopes in Rust**

```rust
#[derive(Debug, Serialize)]
pub struct AgentRequest { pub jsonrpc: &'static str, pub id: u64, pub method: String, pub params: serde_json::Value }

#[derive(Debug, Deserialize)]
pub struct AgentResponse { pub jsonrpc: String, pub id: u64, pub result: Option<serde_json::Value>, pub error: Option<AgentError> }

#[derive(Debug, Deserialize)]
pub struct AgentError { pub code: String, pub message: String }

#[derive(Debug, Deserialize)]
pub struct AgentNotification { pub jsonrpc: String, pub method: String, pub params: serde_json::Value }
```

Reject messages with a protocol version other than `2.0`, duplicate ids, both result and error, neither result nor error, or unknown notification methods.

- [ ] **Step 4: Implement the long-lived child supervisor**

Resolve production Node and entrypoint paths from `current.json`; in development use `node agent-kernel/dist/index.mjs`. Start with cleared environment plus an explicit allowlist for `PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `TAWREED_DATA_DIR`, and `CODEX_HOME`.

`AgentSupervisor` owns stdin, a background line reader, pending `oneshot` senders keyed by request id, and a bounded stderr log tail. A child exit fails all pending requests with `agent_process_exited`.

```rust
pub struct AgentSupervisor {
    process: tokio::sync::Mutex<Option<AgentProcess>>,
    next_id: std::sync::atomic::AtomicU64,
}

struct AgentProcess {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    pending: std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<u64, tokio::sync::oneshot::Sender<Result<Value, String>>>>>,
}

pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
    let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut process = self.process.lock().await;
    let running = process.as_mut().ok_or("agent_not_running")?;
    running.pending.lock().await.insert(id, tx);
    write_request_line(&mut running.stdin, AgentRequest { jsonrpc: "2.0", id, method: method.into(), params }).await?;
    drop(process);
    rx.await.map_err(|_| "agent_process_exited".to_string())?
}
```

- [ ] **Step 5: Initialize and verify protocol version**

Immediately call `kernel.initialize` with app version, data directory, and protocol version. Then call `kernel.health`; refuse the process if it does not report protocol version `1`.

- [ ] **Step 6: Expose narrow Tauri commands**

```rust
#[tauri::command]
pub async fn agent_request(supervisor: tauri::State<'_, AgentSupervisor>, method: String, params: Value) -> Result<Value, String> {
    if !matches!(method.as_str(), "connections.status" | "sessions.start" | "sessions.resume" | "turns.run") {
        return Err("agent_method_not_allowed".into());
    }
    supervisor.request(&method, params).await
}
```

- [ ] **Step 7: Forward normalized notifications**

Only `agent.event` notifications are emitted to the renderer as `agent://event`; validate `runId`, event type length, and payload size before emission.

- [ ] **Step 8: Run Rust tests and checks**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::`

Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 9: Commit the supervisor**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/src/platform_commands.rs src-tauri/src/agent
git commit -m "feat(agent): supervise the local kernel"
```

### Task 11: Implement the Codex SDK bridge and Connections Center

**Files:**
- Create: `agent-kernel/src/providers/codex.ts`
- Create: `tests/codex-bridge.test.ts`
- Create: `src/features/connections/useConnections.ts`
- Create: `src/features/connections/ConnectionsCenter.tsx`
- Create: `tests/connections-state.test.ts`
- Modify: `agent-kernel/src/kernel.ts`
- Modify: `src-tauri/src/codex.rs:277-868`
- Modify: `src-tauri/src/platform_commands.rs`
- Modify: `src/bridge.ts`
- Modify: `src/features/onboarding/Onboarding.tsx`
- Modify: `src/i18n/resources/en.ts`
- Modify: `src/i18n/resources/ar.ts`

**Interfaces:**
- Consumes: `ProviderBridge`, plaintext `ConnectionStore`, managed Codex CLI path, `CODEX_HOME`, and `@openai/codex-sdk` options `apiKey`, `codexPathOverride`, `env`, and `config`.
- Produces: `CodexBridge`, `codex_login_chatgpt`, `codex_login_api_key`, connection health summaries, and a renderer-safe Connections Center.

- [ ] **Step 1: Write failing Codex option and event-normalization tests**

```ts
it('uses file credentials and an isolated CODEX_HOME', async () => {
  const factory = new FakeCodexFactory();
  new CodexBridge({ factory, codexHome: 'C:/Users/test/.tawreed/providers/codex', codexPath: 'C:/runtime/codex.exe', apiKey: 'sk-test' });
  expect(factory.options).toMatchObject({
    apiKey: 'sk-test', codexPathOverride: 'C:/runtime/codex.exe',
    config: { cli_auth_credentials_store: 'file' },
  });
  expect(factory.options.env.CODEX_HOME).toContain('.tawreed/providers/codex');
});

it('normalizes streamed Codex items and completion', async () => {
  const events = collectEvents(fakeCodexStream());
  expect(await events).toEqual([
    { type: 'item.completed', payload: { kind: 'agent_message', text: 'working' } },
    { type: 'turn.completed', payload: { inputTokens: 10, outputTokens: 5 } },
  ]);
});
```

- [ ] **Step 2: Run the test and confirm the missing bridge failure**

Run: `npm test -- tests/codex-bridge.test.ts`

Expected: FAIL because `CodexBridge` is undefined.

- [ ] **Step 3: Implement Codex construction and sessions**

Define an injection seam so tests never call OpenAI:

```ts
export type CodexFactory = (options: ConstructorParameters<typeof Codex>[0]) => Pick<Codex, 'startThread' | 'resumeThread'>;

export interface CodexBridgeOptions {
  factory?: CodexFactory;
  codexHome: string;
  codexPath?: string;
  apiKey?: string;
  allowedEnv: Record<string, string>;
}
```

The production factory is `(options) => new Codex(options)`. `FakeCodexFactory` in the test captures options and returns fake thread objects whose `runStreamed()` yields the exact `fakeCodexStream()` sequence; `collectEvents()` consumes the bridge emitter into an array.

```ts
const createCodex = options.factory ?? ((config) => new Codex(config));
this.codex = createCodex({
  apiKey: options.apiKey,
  codexPathOverride: options.codexPath,
  env: { ...options.allowedEnv, CODEX_HOME: options.codexHome },
  config: { cli_auth_credentials_store: 'file' },
});

const thread = this.codex.startThread({
  workingDirectory: input.workingDirectory,
  skipGitRepoCheck: true,
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  networkAccessEnabled: false,
});
```

Keep a map from Tawreed session id to Codex thread id. Persist the Codex thread id in the project checkpoint so `resumeThread()` works after restart. Normalize SDK events before emitting them; never forward raw reasoning or environment details.

- [ ] **Step 4: Force plaintext Codex credential storage**

Create `~/.tawreed/providers/codex/config.toml` with:

```toml
cli_auth_credentials_store = "file"
```

Set `CODEX_HOME` for every detect, login, model-list, and SDK process. `codex_login_api_key` pipes the saved key to `codex login --with-api-key`; `codex_login_chatgpt` runs the browser flow. Both must write provider-owned credentials beneath the configured Codex home.

- [ ] **Step 5: Write failing Connections Center state tests**

Assert that connection summaries contain no key, the plaintext warning must be acknowledged before first save, ChatGPT login and API-key login are mutually exclusive actions, and a failed health check does not mark the connection ready.

- [ ] **Step 6: Implement safe bridge functions and hook**

Add `listConnections`, `saveApiKeyConnection`, `deleteConnection`, `codexLoginChatgpt`, `codexLoginApiKey`, and `agentHealth` to `src/bridge.ts`. `useConnections()` owns only redacted summaries and transient input text; it clears API-key component state immediately after a successful save.

```ts
const saveCodexKey = useCallback(async (value: string) => {
  setWorking('codex-api-key');
  try {
    await saveApiKeyConnection('codex', value);
    await codexLoginApiKey();
    setApiKey('');
    await refresh();
  } finally {
    setWorking(null);
  }
}, [refresh]);
```

- [ ] **Step 7: Implement the professional Connections Center UI**

Present one Codex card with `Connect with ChatGPT` and `Use API key`. Show the approved one-time warning that credentials are stored locally as plaintext, mask the key field, provide Test and Remove actions, and put provider/model details behind Advanced. Do not show SDK or runtime file paths in primary copy.

```tsx
<PasswordInput value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} autoComplete="off" />
<Checkbox checked={plaintextAcknowledged} onChange={togglePlaintextAcknowledged}
  label={t('plaintextCredentialWarning')} />
<Button disabled={!plaintextAcknowledged || !apiKey.trim()} onClick={() => void saveCodexKey(apiKey)}>
  {t('connect')}
</Button>
```

- [ ] **Step 8: Replace onboarding's old provider panel**

Use `ConnectionsCenter` for the connection step while keeping language/video flow. Completion requires one healthy provider; the user can close non-required settings without a connection.

- [ ] **Step 9: Run provider, UI-state, and Rust tests**

Run: `npm test -- tests/codex-bridge.test.ts tests/connections-state.test.ts`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex:: platform_commands::`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 10: Commit Codex and connections**

```bash
git add agent-kernel src-tauri/src/codex.rs src-tauri/src/platform_commands.rs src/bridge.ts src/features/connections src/features/onboarding src/i18n tests/codex-bridge.test.ts tests/connections-state.test.ts
git commit -m "feat(agent): connect Codex SDK"
```

### Task 12: Deliver the Adaptive Agent Workspace vertical slice

**Files:**
- Create: `src/features/workspace/types.ts`
- Create: `src/features/workspace/reducer.ts`
- Create: `src/features/workspace/ProjectLauncher.tsx`
- Create: `src/features/workspace/AdaptiveWorkspace.tsx`
- Create: `src/features/workspace/AgentRail.tsx`
- Create: `src/features/workspace/WorkspaceTabs.tsx`
- Create: `tests/workspace-reducer.test.ts`
- Create: `public/fonts/InterVariable.woff2`
- Create: `public/fonts/IBMPlexSansArabic-Regular.woff2`
- Create: `public/fonts/IBMPlexSansArabic-SemiBold.woff2`
- Create: `third_party/licenses/OFL-1.1.txt`
- Modify: `src/App.tsx`
- Modify: `src/app/types.ts`
- Modify: `src/bridge.ts`
- Modify: `src/index.css`
- Modify: `src/i18n/resources/en.ts`
- Modify: `src/i18n/resources/ar.ts`

**Interfaces:**
- Consumes: project commands, connection summaries, agent request/event bridge, selected Precision Neutral design.
- Produces: project launcher, B2 Adaptive Workspace, compact/expanded Agent Rail, five tab shells, and a working Codex prompt/resume vertical slice.

Define these reducer contracts in `types.ts`:

```ts
export type WorkspaceTab = 'sources' | 'packages' | 'material-takeoff' | 'decisions' | 'outputs';
export interface WorkspaceState {
  tab: WorkspaceTab;
  agentRail: 'collapsed' | 'expanded';
  activeRunId: string | null;
  sessionId: string | null;
  events: Array<{ type: string; payload: unknown }>;
}
export type WorkspaceAction =
  | { type: 'selectTab'; tab: WorkspaceTab }
  | { type: 'expandAgent' | 'collapseAgent' }
  | { type: 'agentEvent'; event: { type: string; payload: unknown } }
  | { type: 'runStarted'; runId: string }
  | { type: 'runFinished' }
  | { type: 'sessionReady'; sessionId: string };
```

- [ ] **Step 1: Write failing workspace reducer tests**

```ts
it('expands the rail for a decision or agent message', () => {
  const decision = workspaceReducer(initialWorkspaceState, { type: 'agentEvent', event: { type: 'decision.required', payload: {} } });
  expect(decision.agentRail).toBe('expanded');
});

it('preserves the selected tab when the rail collapses', () => {
  const state = { ...initialWorkspaceState, tab: 'material-takeoff' as const, agentRail: 'expanded' as const };
  expect(workspaceReducer(state, { type: 'collapseAgent' }).tab).toBe('material-takeoff');
});
```

- [ ] **Step 2: Run the test and confirm missing workspace failures**

Run: `npm test -- tests/workspace-reducer.test.ts`

Expected: FAIL because the workspace reducer does not exist.

- [ ] **Step 3: Implement project launcher state**

List projects, create a project with name validation, open a project, and show the latest checkpoint state. Include a disabled Import Project action labeled for the later provider/platform expansion plan; do not implement ZIP import in this subproject.

- [ ] **Step 4: Implement the B2 shell**

The main canvas receives the remaining width. The Agent Rail is 48 px collapsed and at most 360 px expanded. Tabs are `sources`, `packages`, `material-takeoff`, `decisions`, and `outputs`; only Sources and Agent are active in this foundation slice, with precise "Available in the next delivery phase" empty states for the rest.

```tsx
export function AdaptiveWorkspace({ project }: Props) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  return <div className="adaptive-workspace">
    <AgentRail state={state} onCollapse={() => dispatch({ type: 'collapseAgent' })} />
    <section className="workspace-canvas">
      <WorkspaceTabs value={state.tab} onChange={(tab) => dispatch({ type: 'selectTab', tab })} />
      <WorkspacePanel project={project} tab={state.tab} />
    </section>
  </div>;
}
```

- [ ] **Step 5: Implement the live Codex vertical slice**

Starting a prompt calls `sessions.start` once per project, stores the returned session id in a checkpoint, uses `sessions.resume` after restart, streams `agent://event` into the rail, and shows the final response. Disable send while a turn is active and expose Cancel.

```ts
const send = async (prompt: string) => {
  const sessionId = state.sessionId ?? await startProjectSession(project.id);
  if (!state.sessionId) dispatch({ type: 'sessionReady', sessionId });
  const runId = crypto.randomUUID();
  dispatch({ type: 'runStarted', runId });
  try { await runAgentTurn({ runId, sessionId, projectId: project.id, prompt }); }
  finally { dispatch({ type: 'runFinished' }); }
};
```

- [ ] **Step 6: Apply Precision Neutral tokens**

Define CSS custom properties for warm graphite, off-white, brass attention, borders, focus, success, and error. Use brass only for active/attention state. Bundle Inter Variable and IBM Plex Sans Arabic Regular/SemiBold under `public/fonts`, add their SIL OFL license text, and declare local `@font-face` rules with no remote font request.

- [ ] **Step 7: Add RTL/LTR and accessibility behavior**

Rail placement follows document direction, tab order remains logical, every icon button has an accessible name, decision/status changes use polite live regions, and focus returns to the composer after a completed turn.

- [ ] **Step 8: Run reducer, accessibility, type, and build checks**

Run: `npm test -- tests/workspace-reducer.test.ts tests/accessibility-ui.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 9: Commit the workspace vertical slice**

```bash
git add src/App.tsx src/app src/bridge.ts src/features/workspace src/index.css src/i18n tests/workspace-reducer.test.ts tests/accessibility-ui.test.ts public/fonts third_party/licenses/OFL-1.1.txt
git commit -m "feat(ui): add adaptive agent workspace"
```

### Task 13: Package and publish the verified Windows runtime pack

**Files:**
- Modify: `agent-kernel/package.json`
- Modify: `agent-kernel/package-lock.json`
- Create: `scripts/generate-runtime-manifest.mjs`
- Create: `scripts/verify-runtime-assets.mjs`
- Modify: `scripts/build-agent-runtime.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml:16-82`
- Modify: `.github/workflows/release.yml:95-420`
- Modify: `scripts/verify-install-script-policy.cjs`
- Modify: `scripts/generate-third-party-licenses.cjs`

**Interfaces:**
- Consumes: Agent Kernel source, Node 24 executable, production Agent Kernel dependency lock, signing secret, and release tag.
- Produces: `Tawreed-AgentRuntime-Windows-x64.zip`, `runtime-manifest.json`, `runtime-manifest.sig`, SHA-256 entries, provenance attestations, and CI smoke evidence.

- [ ] **Step 1: Isolate the runtime dependency graph**

Verify that `@openai/codex-sdk` and `zod` remain isolated in `agent-kernel/package.json`, that `esbuild` remains a root dev dependency, and that the agent lockfile resolves the pinned SDK release.

```json
{
  "name": "@tawreed/agent-kernel",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "dependencies": {
    "@openai/codex-sdk": "0.149.1",
    "zod": "3.24.0"
  }
}
```

Run `npm ci --prefix agent-kernel` and require the lockfile to resolve exactly `@openai/codex-sdk@0.149.1`.

- [ ] **Step 2: Update the build script to assemble, not hide, runtime dependencies**

Build `dist/index.mjs` with Agent Kernel packages external, then create `agent-kernel/runtime-stage/agent/` containing:

```text
agent/node.exe
agent/app/index.mjs
agent/package.json
agent/package-lock.json
agent/node_modules/
```

Run `npm ci --omit=dev --prefix agent-kernel` before copying the complete production dependency tree. Copy Node from `process.execPath`. The runtime pack is internal; the user still sees only `Tawreed.exe`.

```js
await build({
  entryPoints: ['agent-kernel/src/index.ts'],
  outfile: 'agent-kernel/dist/index.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node24',
  format: 'esm',
});
await cp(process.execPath, join(stage, process.platform === 'win32' ? 'node.exe' : 'node'));
await cp('agent-kernel/dist/index.mjs', join(stage, 'app/index.mjs'));
await cp('agent-kernel/node_modules', join(stage, 'node_modules'), { recursive: true });
```

- [ ] **Step 3: Write failing manifest generation tests**

Create a fixture archive and assert the script emits stable sorted JSON, exact byte size, lowercase SHA-256, canonical GitHub release URL, and a detached Ed25519 signature that the Rust verifier accepts.

Run: `node scripts/verify-runtime-assets.mjs --fixture`

Expected: FAIL until manifest generation is implemented.

- [ ] **Step 4: Implement signing without logging the private key**

`generate-runtime-manifest.mjs` reads the private key from `TAWREED_RUNTIME_SIGNING_KEY`, accepts release tag/asset path/target, writes canonical JSON with a trailing newline, signs those exact bytes using Node `crypto.sign`, and writes the Base64 signature only.

```js
const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
const signature = sign(null, bytes, process.env.TAWREED_RUNTIME_SIGNING_KEY);
await writeFile(outputManifest, bytes);
await writeFile(outputSignature, `${signature.toString('base64')}\n`);
```

- [ ] **Step 5: Extend CI with an offline runtime smoke test**

On Windows CI:

1. `npm ci --prefix agent-kernel`;
2. `npm run agent:build`;
3. run the staged `node.exe app/index.mjs --health-check`;
4. archive the stage;
5. generate a test-signed manifest;
6. verify the manifest and archive; and
7. build `Tawreed.exe`.

- [ ] **Step 6: Extend release staging before publication**

Create and attest the runtime ZIP, manifest, signature, `SHA256SUMS.txt`, and SBOM while the GitHub release is still a draft. Add the four assets to the exact release-asset allowlist before the workflow publishes the release. Remove `--clobber` after immutable release publication; retries may replace assets only while the release is a draft.

- [ ] **Step 7: Update dependency and license verification**

Run lifecycle-policy checks against both lockfiles, include runtime production packages in third-party notices, and fail if the runtime archive contains a package not present in the generated notices.

- [ ] **Step 8: Run local release-script checks**

Run: `npm ci --prefix agent-kernel`

Run: `npm run agent:build`

Run: `npm run agent:health`

Run: `node scripts/verify-runtime-assets.mjs --fixture`

Expected: all commands PASS.

- [ ] **Step 9: Commit runtime packaging**

```bash
git add agent-kernel/package.json agent-kernel/package-lock.json package.json package-lock.json scripts .github/workflows/ci.yml .github/workflows/release.yml THIRD_PARTY_NOTICES.md
git commit -m "build(runtime): publish verified agent packs"
```

### Task 14: Prove the complete Platform Foundation and update documentation

**Files:**
- Create: `scripts/smoke-platform-foundation.mjs`
- Create: `tests/platform-foundation.test.ts`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PRIVACY.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `SECURITY.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: every task in this plan.
- Produces: repeatable end-to-end smoke coverage, verified documentation, and the final release-readiness evidence for Platform Foundation.

- [ ] **Step 1: Write an end-to-end smoke script against a temporary home**

The script must:

1. create a temporary `.tawreed` root;
2. build and launch the Agent Kernel;
3. send `kernel.initialize` and `kernel.health` JSON-RPC lines;
4. create a project through the Rust test harness or a fixture command;
5. save and reload a checkpoint;
6. verify no stdout diagnostic text; and
7. terminate the child cleanly.

```js
const child = spawn(process.execPath, ['agent-kernel/dist/index.mjs'], {
  env: { PATH: process.env.PATH ?? '', TAWREED_DATA_DIR: tempRoot, CODEX_HOME: join(tempRoot, 'providers/codex') },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'kernel.health', params: {} })}\n`);
```

- [ ] **Step 2: Add static release-contract tests**

`tests/platform-foundation.test.ts` reads source/config files and asserts that:

- Tauri registers bootstrap, project, connection, and agent commands;
- the CSP still excludes arbitrary internet access from the webview;
- `connections.json` never appears in export code or renderer payload types;
- CI builds the runtime before the portable executable; and
- release allowlists include every signed runtime asset.

```ts
it('keeps credentials out of renderer and project export contracts', () => {
  const shared = readFileSync('shared/platform.ts', 'utf8');
  const commands = readFileSync('src-tauri/src/platform_commands.rs', 'utf8');
  expect(shared).not.toContain('apiKey:');
  expect(commands).not.toMatch(/export_project[\s\S]*connections\.json/);
});

it('publishes the complete signed runtime set', () => {
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  for (const name of ['Tawreed-AgentRuntime-Windows-x64.zip', 'runtime-manifest.json', 'runtime-manifest.sig']) {
    expect(release).toContain(name);
  }
});
```

- [ ] **Step 3: Run the smoke and targeted tests**

Run: `node scripts/smoke-platform-foundation.mjs`

Expected: PASS with one health response and clean shutdown.

Run: `npm test -- tests/platform-foundation.test.ts tests/platform-contracts.test.ts tests/agent-protocol.test.ts tests/codex-bridge.test.ts tests/bootstrap-reducer.test.ts tests/workspace-reducer.test.ts`

Expected: PASS.

- [ ] **Step 4: Update durable product and engineering documentation**

Document:

- the one-visible-executable model;
- first-run internet requirement and retry behavior;
- exact `~/.tawreed` layout;
- plaintext credential warning and removal flow;
- Agent Kernel process boundary;
- GitHub Release signature/provenance verification;
- pause-on-exit and checkpoint resume;
- Windows-first/cross-platform sequence; and
- the fact that Package Architecture and MTO are subsequent subprojects.

Add `.superpowers/` to `.gitignore`; do not delete the user's local brainstorming files.

- [ ] **Step 5: Run the complete repository verification**

Run: `npm run check`

Expected: PASS.

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`

Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml --locked`

Expected: PASS.

Run: `npm run tauri -- build --no-bundle --ci -- --locked`

Expected: creates `src-tauri/target/release/tawreed.exe` and the executable exceeds the existing 10 MB CI floor.

- [ ] **Step 6: Perform the visual and interruption checks**

Run the Tauri development app and verify with the Browser plugin where supported:

- first-run progress at 100%, 125%, and 150% display scaling;
- English LTR and Arabic RTL;
- keyboard-only setup, project creation, tab navigation, agent expansion, and cancellation;
- runtime download interruption followed by resume;
- invalid-signature error with no activation;
- app close during an active turn followed by checkpoint recovery; and
- plaintext warning appears once before the first API-key save.

Record pass/fail evidence in the implementation handoff; do not commit local credentials or downloaded runtime packs.

- [ ] **Step 7: Commit the completed foundation**

```bash
git add .gitignore README.md SECURITY.md docs scripts/smoke-platform-foundation.mjs tests/platform-foundation.test.ts
git commit -m "docs(platform): verify the agent foundation"
```

## Spec Coverage Matrix

| Platform Foundation requirement | Implemented by |
| --- | --- |
| One visible executable and managed `~/.tawreed` runtime | Tasks 2, 6, 7, 8, 13 |
| Text-first settings, connections, history, projects, and checkpoints | Tasks 2–5 |
| Plaintext credentials with renderer redaction | Tasks 3, 11, 14 |
| Signed GitHub Release manifests, digest checks, activation, and rollback | Tasks 6, 7, 13 |
| Local TypeScript/Node Agent Kernel with no public port | Tasks 9–10 |
| Provider-neutral bridge contract and Codex SDK first bridge | Tasks 9, 11 |
| File-based Codex authentication under Tawreed data root | Task 11 |
| First-run nontechnical setup and AI Connections Center | Tasks 8, 11 |
| Project launcher, Adaptive Agent Workspace, and resumable thread | Tasks 5, 11, 12 |
| Windows-first build that preserves cross-platform contracts | Tasks 2, 6, 10, 13, 14 |
| Complete automated, visual, interruption, and release verification | Tasks 13–14 |

## Completion Gate

Platform Foundation is complete only when all fourteen task commits are present, the complete verification suite passes, Windows produces one visible `Tawreed.exe`, a fresh profile can bootstrap a signed runtime into `~/.tawreed`, Codex can start and resume a thread through the local kernel, the renderer never receives credentials, and an interrupted task resumes from a text checkpoint.

The next plan after this gate is `AI Package Preparation`; Material Takeoff and provider/platform expansion remain separate later plans.
