import type { RuntimeBootstrapStatus } from '../../../shared/platform';
import { runtimeBootstrapStatusSchema } from '../../../shared/platform';

export const PUBLIC_RUNTIME_ERROR_CODES = [
  'runtime_health_check_failed',
  'runtime_install_security_error',
  'runtime_download_failed',
  'runtime_download_invalid_response',
  'runtime_download_too_large',
  'runtime_download_cleanup_failed',
  'runtime_size_mismatch',
  'runtime_hash_mismatch',
  'runtime_staging_failed',
  'runtime_extraction_failed',
  'runtime_activation_failed',
  'runtime_manifest_download_failed',
  'invalid_runtime_signature',
  'invalid_runtime_manifest',
  'invalid_runtime_asset',
  'runtime_manifest_too_large',
  'runtime_manifest_signature_too_large',
  'runtime_asset_unavailable',
  'runtime_platform_unsupported',
  'runtime_internal_error',
  'runtime_protocol_invalid',
] as const;

export type PublicRuntimeErrorCode = (typeof PUBLIC_RUNTIME_ERROR_CODES)[number];
const publicRuntimeErrorCodes = new Set<string>(PUBLIC_RUNTIME_ERROR_CODES);
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const BROWSER_READY_RUNTIME_STATUS: RuntimeBootstrapStatus = Object.freeze({
  phase: 'ready',
  progress: 100,
  component: null,
  version: null,
  errorCode: null,
  recoverable: false,
});

export const RUNTIME_PROTOCOL_ERROR_STATUS: RuntimeBootstrapStatus = Object.freeze({
  phase: 'error',
  progress: null,
  component: null,
  version: null,
  errorCode: 'runtime_protocol_invalid',
  recoverable: true,
});

export const INITIAL_RUNTIME_STATUS: RuntimeBootstrapStatus = Object.freeze({
  phase: 'checking',
  progress: null,
  component: null,
  version: null,
  errorCode: null,
  recoverable: false,
});

export function parseRuntimeStatus(value: unknown): RuntimeBootstrapStatus {
  const parsed = runtimeBootstrapStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : RUNTIME_PROTOCOL_ERROR_STATUS;
}

export function isPublicRuntimeErrorCode(value: string | null): value is PublicRuntimeErrorCode {
  return value !== null && publicRuntimeErrorCodes.has(value);
}

export function runtimeTechnicalDetails(status: RuntimeBootstrapStatus): string[] {
  const details: string[] = [];
  if (isPublicRuntimeErrorCode(status.errorCode)) details.push(status.errorCode);
  if (status.component === 'agent-kernel') details.push(status.component);
  if (status.version && semanticVersion.test(status.version)) details.push(status.version);
  return details;
}
