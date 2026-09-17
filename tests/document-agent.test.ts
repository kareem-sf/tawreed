import { describe, expect, it } from 'vitest';
import { inspectWorkbook } from '../engine/ingest';
import { refineInspectionWithAgent } from '../engine/document-agent';
import { commentsFixture } from './fixtures';

describe('grounded document agent', () => {
  it('can select a grounded project candidate and reassign exact comment IDs', async () => {
    const inspection = await inspectWorkbook(await commentsFixture(), 'Factory Extension BOQ.xlsx');
    inspection.projectNameCandidates.push('Factory Extension');
    const comments = inspection.items.flatMap((item) => item.comments ?? []);
    const refined = await refineInspectionWithAgent(inspection, async () => JSON.stringify({
      projectName: 'Factory Extension',
      comments: comments.map((_, index) => ({ commentId: `${index < (inspection.items[0]!.comments?.length ?? 0) ? 1 : 2}-${index < (inspection.items[0]!.comments?.length ?? 0) ? index + 1 : index - (inspection.items[0]!.comments?.length ?? 0) + 1}`, itemId: index < 4 ? 1 : 2 })),
    }));
    expect(refined.projectName).toBe('Factory Extension');
    expect(refined.projectNameConfidence).toBeGreaterThanOrEqual(0.85);
    expect(refined.items[0]!.comments?.length).toBeGreaterThan(0);
  });

  it('rejects project names that were not extracted from the document', async () => {
    const inspection = await inspectWorkbook(await commentsFixture(), 'Factory.xlsx');
    const comments = inspection.items.flatMap((item) => item.comments ?? []);
    await expect(refineInspectionWithAgent(inspection, async () => JSON.stringify({
      projectName: 'Invented Mega Project',
      comments: comments.map((_, index) => ({ commentId: `1-${index + 1}`, itemId: 1 })),
    }))).rejects.toThrow(/ungrounded project/i);
  });

  it.each([
    ['Original Project', 0.39, 0.85],
    ['Alternative Project', 0.39, 0.85],
    ['Original Project', 0.95, 0.95],
    ['Alternative Project', 0.95, 0.95],
  ] as const)('applies the existing confidence floor for %s at %s', async (projectName, confidence, expected) => {
    const inspection = await inspectWorkbook(await commentsFixture(), 'Factory.xlsx');
    inspection.projectName = 'Original Project';
    inspection.projectNameConfidence = confidence;
    inspection.projectNameCandidates = ['Original Project', 'Alternative Project'];
    const comments = inspection.items.flatMap((item) =>
      (item.comments ?? []).map((_, index) => ({ commentId: `${item.id}-${index + 1}`, itemId: item.id })),
    );

    const refined = await refineInspectionWithAgent(inspection, async () => JSON.stringify({ projectName, comments }));

    expect(refined.projectName).toBe(projectName);
    expect(refined.projectNameConfidence).toBe(expected);
    expect(inspection.projectName).toBe('Original Project');
    expect(inspection.projectNameConfidence).toBe(confidence);
  });
});
