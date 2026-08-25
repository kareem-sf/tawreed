import { describe, expect, it } from 'vitest';
import ar from '../src/i18n/resources/ar';
import en from '../src/i18n/resources/en';

const expectedLeaves = [
  'runtimePhase.checking',
  'runtimePhase.downloading',
  'runtimePhase.verifying',
  'runtimePhase.activating',
  'runtimePhase.ready',
  'runtimePhase.error',
  'runtimeError.runtime_health_check_failed',
  'runtimeError.runtime_install_security_error',
  'runtimeError.runtime_download_failed',
  'runtimeError.runtime_download_invalid_response',
  'runtimeError.runtime_download_too_large',
  'runtimeError.runtime_download_cleanup_failed',
  'runtimeError.runtime_size_mismatch',
  'runtimeError.runtime_hash_mismatch',
  'runtimeError.runtime_staging_failed',
  'runtimeError.runtime_extraction_failed',
  'runtimeError.runtime_activation_failed',
  'runtimeError.runtime_manifest_download_failed',
  'runtimeError.invalid_runtime_signature',
  'runtimeError.invalid_runtime_manifest',
  'runtimeError.invalid_runtime_asset',
  'runtimeError.runtime_manifest_too_large',
  'runtimeError.runtime_manifest_signature_too_large',
  'runtimeError.runtime_asset_unavailable',
  'runtimeError.runtime_platform_unsupported',
  'runtimeError.runtime_internal_error',
  'runtimeError.runtime_protocol_invalid',
  'runtimeError.unknown',
] as const;

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  if (!value || typeof value !== 'object') return leaves;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') leaves.set(path, child);
    else for (const [nestedPath, text] of flatten(child, path)) leaves.set(nestedPath, text);
  }
  return leaves;
}

describe('runtime bootstrap localization', () => {
  it('has exact recursive English and Arabic phase/error parity', () => {
    const english = flatten(en);
    const arabic = flatten(ar);
    const runtimeEnglish = [...english.keys()].filter(
      (key) => key.startsWith('runtimePhase.') || key.startsWith('runtimeError.'),
    );
    const runtimeArabic = [...arabic.keys()].filter(
      (key) => key.startsWith('runtimePhase.') || key.startsWith('runtimeError.'),
    );

    expect(runtimeEnglish.sort()).toEqual([...expectedLeaves].sort());
    expect(runtimeArabic.sort()).toEqual([...expectedLeaves].sort());
    for (const key of expectedLeaves) {
      expect(english.get(key)?.trim(), `missing en ${key}`).toBeTruthy();
      expect(arabic.get(key)?.trim(), `missing ar ${key}`).toBeTruthy();
    }
  });
});
