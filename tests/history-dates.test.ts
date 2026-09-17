import { describe, expect, it } from 'vitest';
import { formatRunDate, formatRunForSupport } from '../src/features/history/formatRunForSupport';
import type { RunRecord } from '../shared/types';

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    startedAt: '2026-09-01T10:00:00.000Z',
    fileName: 'boq.xlsx',
    fileHash: 'abc',
    itemCount: 2,
    packageCount: 1,
    errorCount: 0,
    warningCount: 0,
    outputFile: '/out/master.xlsx',
    durationMs: 1000,
    llmUsed: false,
    projectName: 'Sample',
    revision: 1,
    packageFolder: '/out',
    sourceKind: 'xlsx',
    ocrUsed: false,
    provider: 'offline',
    model: '',
    trace: [{ at: '2026-09-01T10:00:01.000Z', stage: 'inspect', status: 'completed', detail: 'ok' }],
    memoryApplied: 0,
    ...over,
  };
}

describe('formatRunDate', () => {
  it('formats valid dates and degrades corrupt ones to unknown', () => {
    expect(formatRunDate('2026-09-01T10:00:00.000Z', (d) => d.toISOString()))
      .toBe('2026-09-01T10:00:00.000Z');
    expect(formatRunDate('not-a-date', (d) => d.toISOString())).toBe('unknown date');
    expect(formatRunDate('', (d) => d.toISOString())).toBe('unknown date');
  });

  it('never emits Invalid Date in the support dump', () => {
    const text = formatRunForSupport(run({
      startedAt: 'garbage',
      trace: [{ at: 'also-garbage', stage: 'classify', status: 'completed', detail: 'x' }],
    }));
    expect(text).not.toContain('Invalid Date');
    expect(text).toContain('unknown date');
  });
});
