// Bridge to the Rust host. In a plain browser (vite dev), commands degrade gracefully.
import { invoke } from '@tauri-apps/api/core';
import type { RunRecord } from '../shared/types';
import type { AnthropicRequest } from '../engine/classify/anthropic';
import type { GeneratedArtifact } from '../engine/generate';

export interface BootstrapInfo {
  first_run: boolean;
  data_dir: string;
  has_api_key: boolean;
  run_count: number;
  version: string;
  provider: 'codex' | 'anthropic' | 'none';
  codex_installed: boolean;
  codex_authenticated: boolean;
}

export interface CodexStatus {
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  path: string | null;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  latest_tag: string;
  update_available: boolean;
  asset_name: string;
  asset_sha256: string | null;
  published_at: string | null;
}

export const isDesktop = () => '__TAURI_INTERNALS__' in window;

export async function bootstrap(): Promise<BootstrapInfo> {
  if (!isDesktop()) {
    return {
      first_run: false, data_dir: '(browser dev — no data dir)', has_api_key: false,
      run_count: 0, version: 'dev', provider: 'none', codex_installed: false, codex_authenticated: false,
    };
  }
  return invoke<BootstrapInfo>('bootstrap');
}

export async function setApiKey(key: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke('set_api_key', { key });
}

export async function deleteApiKey(): Promise<void> {
  if (!isDesktop()) return;
  await invoke('delete_api_key');
}

/** Transport injected into the engine's Anthropic classifier — HTTP happens in Rust. */
export function makeLlmTransport() {
  return async (request: AnthropicRequest): Promise<string> => {
    if (!isDesktop()) throw new Error('LLM transport is only available in the desktop app');
    return invoke<string>('llm_complete', { request });
  };
}

/** Transport that routes classification through the Codex CLI (ChatGPT subscription quota). */
export function makeCodexTransport(model?: string | null) {
  return async (request: AnthropicRequest): Promise<string> => {
    if (!isDesktop()) throw new Error('Codex transport is only available in the desktop app');
    const { requestToPrompt } = await import('../engine/classify/anthropic');
    return invoke<string>('codex_complete', { prompt: requestToPrompt(request), model: model ?? null });
  };
}

export interface ModelInfo {
  slug: string;
  display_name: string;
  description: string;
  default_reasoning_level: string | null;
}

export async function codexModels(): Promise<ModelInfo[]> {
  if (!isDesktop()) return [];
  return invoke<ModelInfo[]>('codex_models');
}

export async function getSettings(): Promise<Record<string, unknown>> {
  if (!isDesktop()) return {};
  return invoke<Record<string, unknown>>('get_settings');
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await invoke('set_setting', { key, value });
}

export async function codexStatus(): Promise<CodexStatus> {
  if (!isDesktop()) return { installed: false, authenticated: false, version: null, path: null };
  return invoke<CodexStatus>('codex_status');
}

export async function codexInstall(): Promise<string> {
  if (!isDesktop()) return '';
  return invoke<string>('codex_install');
}

export async function codexLogin(): Promise<void> {
  if (!isDesktop()) return;
  await invoke('codex_login');
}

export async function writeWorkbook(bytes: Uint8Array, filename: string): Promise<string> {
  if (!isDesktop()) return '';
  return invoke<string>('write_workbook', { bytesB64: encodeBytes(bytes), filename });
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface RevisionReservation {
  projectName: string;
  revision: number;
  revisionLabel: string;
  session: string;
}

export interface RevisionOutput {
  projectName: string;
  revision: number;
  revisionLabel: string;
  masterPath: string;
  packageFolder: string;
  revisionFolder: string;
  files: string[];
}

export async function reserveRevision(projectName: string): Promise<RevisionReservation> {
  if (!isDesktop()) throw new Error('Desktop only');
  return invoke<RevisionReservation>('reserve_revision', { projectName });
}

export async function writeRevisionBundle(
  reservation: RevisionReservation,
  artifacts: GeneratedArtifact[],
): Promise<RevisionOutput> {
  if (!isDesktop()) throw new Error('Desktop only');
  return invoke<RevisionOutput>('write_revision_bundle', {
    projectName: reservation.projectName,
    session: reservation.session,
    revision: reservation.revision,
    artifacts: artifacts.map((artifact) => ({
      relativePath: artifact.relativePath,
      bytesB64: encodeBytes(artifact.bytes),
      kind: artifact.kind,
    })),
  });
}

export async function discardRevision(reservation: RevisionReservation): Promise<void> {
  if (!isDesktop()) return;
  await invoke('discard_revision', { projectName: reservation.projectName, session: reservation.session });
}

export async function readInputFile(path: string): Promise<File> {
  const input = await invoke<{ bytes: string; name: string; mime: string }>('read_input_file', { path });
  const binary = atob(input.bytes);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new File([bytes], input.name || path.split(/[\\/]/).pop() || 'input', { type: input.mime });
}

export async function recordRun(entry: Omit<RunRecord, 'id'>): Promise<number> {
  if (!isDesktop()) return 0;
  return invoke<number>('record_run', { entry });
}

export async function listRuns(): Promise<RunRecord[]> {
  if (!isDesktop()) return [];
  return invoke<RunRecord[]>('list_runs');
}

export async function openOutputFolder(): Promise<void> {
  if (!isDesktop()) return;
  await invoke('open_output_folder');
}

export async function openGeneratedFolder(path: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke('open_generated_folder', { path });
}

export async function openWorkbook(path: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke('open_workbook', { path });
}

export async function openUrl(url: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke('open_url', { url });
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!isDesktop()) throw new Error('desktop_only');
  return invoke<UpdateInfo>('check_for_update');
}

export async function openUpdateRelease(version: string): Promise<void> {
  if (!isDesktop()) return;
  await invoke('open_update_release', { version });
}

export async function appLog(message: string): Promise<void> {
  if (isDesktop()) await invoke('app_log', { message });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
