// @vitest-environment jsdom
//
// bridge.ts is the single hand-mirrored seam between the webview and Rust: it has no
// codegen, several invoke names are built from template literals, and it owns the AI
// cancellation protocol. verify-commands.cjs guards the command *names*; these tests
// cover the behaviour around them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

/** The bridge decides desktop vs browser by sniffing the Tauri global off `window`. */
function setDesktop(enabled: boolean): void {
  if (enabled) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

async function loadBridge() {
  vi.resetModules();
  return import('../src/bridge');
}

beforeEach(() => {
  invoke.mockReset();
  setDesktop(true);
});

afterEach(() => {
  setDesktop(false);
  vi.useRealTimers();
});

describe('desktop guards', () => {
  it('reports desktop only when the Tauri global is present', async () => {
    const bridge = await loadBridge();
    expect(bridge.isDesktop()).toBe(true);
    setDesktop(false);
    expect(bridge.isDesktop()).toBe(false);
  });

  it('never reaches Rust for a provider test in the browser', async () => {
    setDesktop(false);
    const bridge = await loadBridge();
    await expect(bridge.testAnthropicProvider()).resolves.toBe(false);
    await expect(bridge.testCompatibleProvider()).resolves.toBe(false);
    await expect(bridge.testGeminiProvider()).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses to run an AI transport in the browser instead of failing inside Rust', async () => {
    setDesktop(false);
    const bridge = await loadBridge();
    const request = { model: 'm', max_tokens: 8, system: '', messages: [] };
    await expect(bridge.makeLlmTransport()(request)).rejects.toThrow(/only available in the desktop app/);
    await expect(bridge.makeGeminiTransport()(request)).rejects.toThrow(/only available in the desktop app/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('provider command names', () => {
  it('maps each named provider onto its own Rust commands', async () => {
    const bridge = await loadBridge();
    invoke.mockResolvedValue(true);

    await bridge.testGeminiProvider();
    await bridge.testGrokProvider();
    await bridge.setGeminiApiKey('k');
    await bridge.deleteGrokApiKey();
    await bridge.testAnthropicProvider();

    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      'gemini_test', 'grok_test', 'set_gemini_api_key', 'delete_grok_api_key', 'anthropic_test',
    ]);
    expect(invoke.mock.calls[2]?.[1]).toEqual({ key: 'k' });
  });
});

describe('invokeAi cancellation', () => {
  it('passes a job id alongside the request and returns the completion', async () => {
    const bridge = await loadBridge();
    invoke.mockResolvedValue('grouped');

    await expect(bridge.invokeAi('gemini_complete', { request: {} })).resolves.toBe('grouped');

    const [command, args] = invoke.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe('gemini_complete');
    expect(typeof args.jobId).toBe('string');
    expect(args.jobId).not.toBe('');
  });

  it('throws AbortError without calling Rust when the signal is already aborted', async () => {
    const bridge = await loadBridge();
    const controller = new AbortController();
    controller.abort();

    await expect(bridge.invokeAi('llm_complete', {}, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('normalises a Rust cancellation into AbortError so the workflow can tell it apart', async () => {
    const bridge = await loadBridge();
    const controller = new AbortController();
    invoke.mockRejectedValue(new Error('AI job cancelled'));

    await expect(bridge.invokeAi('grok_complete', {}, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('leaves a genuine provider failure as-is rather than disguising it as a cancel', async () => {
    const bridge = await loadBridge();
    invoke.mockRejectedValue(new Error('gemini error 401: invalid key'));

    await expect(bridge.invokeAi('gemini_complete', {}))
      .rejects.toThrow(/invalid key/);
  });

  it('retries cancel until Rust has registered the job, then stops', async () => {
    vi.useFakeTimers();
    const bridge = await loadBridge();
    const controller = new AbortController();
    let resolveCompletion: (value: string) => void = () => {};

    invoke.mockImplementation((command: string) => {
      // The job races its own cancel: Rust reports "not found" until it registers.
      if (command === 'cancel_ai_job') {
        const found = invoke.mock.calls.filter((c) => c[0] === 'cancel_ai_job').length > 1;
        return Promise.resolve(found);
      }
      return new Promise<string>((resolve) => { resolveCompletion = resolve; });
    });

    const pending = bridge.invokeAi('llm_complete', {}, controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(250);

    const cancels = invoke.mock.calls.filter((call) => call[0] === 'cancel_ai_job');
    expect(cancels.length).toBeGreaterThan(1);

    resolveCompletion('done');
    await expect(pending).resolves.toBe('done');

    // Once the call settles the retry loop must stop rather than spin forever.
    const after = invoke.mock.calls.filter((call) => call[0] === 'cancel_ai_job').length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invoke.mock.calls.filter((call) => call[0] === 'cancel_ai_job')).toHaveLength(after);
  });
});
