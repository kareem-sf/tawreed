import { describe, expect, it } from 'vitest';
import { runtimeBootstrapStatusSchema } from '../shared/platform';
import {
  BROWSER_READY_RUNTIME_STATUS,
  RUNTIME_PROTOCOL_ERROR_STATUS,
  parseRuntimeStatus,
  runtimeTechnicalDetails,
} from '../src/features/bootstrap/types';
import { bootstrapReducer, initialBootstrapState } from '../src/features/bootstrap/reducer';

const downloading = {
  phase: 'downloading' as const,
  progress: 25,
  component: 'agent-kernel',
  version: '1.0.0',
  errorCode: null,
  recoverable: false,
};

describe('runtime bootstrap status boundary', () => {
  it('accepts only the complete renderer status shape', () => {
    expect(runtimeBootstrapStatusSchema.parse(downloading)).toEqual(downloading);

    const invalidValues = [
      { ...downloading, extra: true },
      { ...downloading, phase: 'installing' },
      { ...downloading, progress: -1 },
      { ...downloading, progress: 101 },
      { ...downloading, component: 'x'.repeat(81) },
      { ...downloading, version: 'x'.repeat(41) },
      { ...downloading, errorCode: 'x'.repeat(81) },
      { ...downloading, component: '' },
      { ...downloading, version: undefined },
      { ...downloading, recoverable: 'yes' },
    ];

    for (const value of invalidValues) {
      expect(runtimeBootstrapStatusSchema.safeParse(value).success).toBe(false);
    }
  });

  it('maps unknown host values to the exact canonical protocol error', () => {
    expect(parseRuntimeStatus({ ...downloading, progress: Number.NaN }))
      .toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);
    expect(parseRuntimeStatus(Promise.resolve(downloading)))
      .toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);
  });

  it('publishes complete valid transitions without retaining stale fields', () => {
    const progress = bootstrapReducer(initialBootstrapState, {
      type: 'status',
      status: downloading,
    });
    expect(progress.status).toEqual(downloading);

    const ready = bootstrapReducer(progress, {
      type: 'status',
      status: BROWSER_READY_RUNTIME_STATUS,
    });
    expect(ready.status).toEqual(BROWSER_READY_RUNTIME_STATUS);
  });

  it('maps protocol failures exactly and never partially applies invalid status', () => {
    const progress = bootstrapReducer(initialBootstrapState, {
      type: 'status',
      status: downloading,
    });
    const invalid = bootstrapReducer(progress, {
      type: 'status',
      status: { ...downloading, progress: 250 },
    });
    expect(invalid.status).toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);

    expect(bootstrapReducer(progress, { type: 'protocolError' }).status)
      .toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);
  });

  it('exposes technical details only for approved bounded values', () => {
    expect(runtimeTechnicalDetails({
      phase: 'error', progress: null, component: 'agent-kernel', version: '1.2.3',
      errorCode: 'runtime_hash_mismatch', recoverable: true,
    })).toEqual(['runtime_hash_mismatch', 'agent-kernel', '1.2.3']);
    expect(runtimeTechnicalDetails({
      phase: 'error', progress: null, component: 'C:\\private', version: 'private',
      errorCode: 'future_private_error', recoverable: true,
    })).toEqual([]);
  });
});
