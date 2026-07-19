import { describe, it, expect } from 'vitest';
import { runPipeline } from '../engine/pipeline';
import { enFixture } from './fixtures';

describe('runPipeline', () => {
  it('rejects when LLM classification is requested without a transport', async () => {
    // The English fixture contains a gibberish line the heuristic cannot place, so
    // classification reaches the LLM path — which must fail loudly with no transport.
    await expect(runPipeline(await enFixture(), 'en.xlsx', { useLlm: true })).rejects.toThrow(/transport/i);
  });
});
