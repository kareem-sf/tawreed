import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  CodexOptions,
  Thread,
  ThreadEvent,
  ThreadOptions,
  Usage,
} from '@openai/codex-sdk';
import type {
  CodexFactory,
} from '../agent-kernel/src/providers/codex';
import { CodexBridge } from '../agent-kernel/src/providers/codex';
import type {
  ProviderEvent,
  ResumeSessionInput,
} from '../agent-kernel/src/providers/types';

const PROJECT_ID = '123e4567-e89b-42d3-a456-426614174000';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

async function makeWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tawreed-codex-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input_tokens: 10,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 0,
    ...overrides,
  };
}

interface CapturedThreadCall {
  threadOptions: ThreadOptions;
  resumedId: string | null;
}

interface FakeCodex {
  options: CodexOptions;
  calls: CapturedThreadCall[];
  streams: ThreadEvent[][];
  nextStream: (events: ThreadEvent[]) => void;
  bridge: CodexFactory;
}

function makeFakeCodex(): FakeCodex {
  const fake: FakeCodex = {
    options: {},
    calls: [],
    streams: [],
    nextStream: (events) => {
      fake.streams.push(events);
    },
    bridge: () => {
      throw new Error('not built');
    },
  };
  const build = (): CodexFactory => (options) => {
    fake.options = options ?? {};
    return {
      startThread: (threadOptions?: ThreadOptions): Thread => {
        fake.calls.push({ threadOptions: threadOptions ?? {}, resumedId: null });
        return fakeThread(fake.streams.shift() ?? []);
      },
      resumeThread: (id: string, threadOptions?: ThreadOptions): Thread => {
        fake.calls.push({ threadOptions: threadOptions ?? {}, resumedId: id });
        return fakeThread(fake.streams.shift() ?? []);
      },
    };
  };
  fake.bridge = build();
  return fake;
}

function fakeThread(events: ThreadEvent[]): Thread {
  return {
    runStreamed: async () => ({
      events: (async function* generate(): AsyncGenerator<ThreadEvent> {
        for (const event of events) yield event;
      })(),
    }),
  } as unknown as Thread;
}

async function startStreamedTurn(stream: ThreadEvent[]): Promise<{
  collected: ProviderEvent[];
  done: Promise<{ finalResponse: string }>;
  fake: FakeCodex;
}> {
  const fake = makeFakeCodex();
  fake.nextStream(stream);
  const workspace = await makeWorkspace();
  const bridge = new CodexBridge({
    factory: fake.bridge,
    codexHome: join(workspace, 'providers', 'codex'),
    allowedEnv: {},
  });
  const started = await bridge.startSession({
    projectId: PROJECT_ID,
    workingDirectory: workspace,
  });
  const collected: ProviderEvent[] = [];
  const done = bridge.runTurn(
    { runId: 'run-1', sessionId: started.sessionId, prompt: 'hello' },
    (event) => collected.push(event),
  );
  return { collected, done, fake };
}

function collectEvents(stream: ThreadEvent[]): Promise<ProviderEvent[]> {
  return startStreamedTurn(stream).then((turn) => turn.done.then(() => turn.collected));
}

function fakeCodexStream(): ThreadEvent[] {
  return [
    { type: 'thread.started', thread_id: 'thread-123' },
    { type: 'item.completed', item: { id: 'm0', type: 'agent_message', text: 'working' } },
    { type: 'turn.completed', usage: usage() },
  ];
}

describe('Codex SDK bridge construction', () => {
  it('uses file credentials and an isolated CODEX_HOME', async () => {
    const fake = makeFakeCodex();
    new CodexBridge({
      factory: fake.bridge,
      codexHome: 'C:/Users/test/.tawreed/providers/codex',
      codexPath: 'C:/runtime/codex.exe',
      apiKey: 'sk-test',
    });
    expect(fake.options).toMatchObject({
      apiKey: 'sk-test',
      codexPathOverride: 'C:/runtime/codex.exe',
      config: { cli_auth_credentials_store: 'file' },
    });
    expect(
      (fake.options as { env: Record<string, string> }).env.CODEX_HOME,
    ).toContain('.tawreed/providers/codex');
  });

  it('keeps the allowlisted environment alongside CODEX_HOME without inheriting the rest', () => {
    const fake = makeFakeCodex();
    new CodexBridge({
      factory: fake.bridge,
      codexHome: '/home/test/.tawreed/providers/codex',
      allowedEnv: { PATH: '/usr/bin', SYSTEMROOT: 'C:/WINDOWS' },
    });
    expect(fake.options.env).toEqual({
      PATH: '/usr/bin',
      SYSTEMROOT: 'C:/WINDOWS',
      CODEX_HOME: '/home/test/.tawreed/providers/codex',
    });
  });

  it('hardens every thread with a read-only sandbox, no approvals, and no network', async () => {
    const turn = await startStreamedTurn([
      { type: 'turn.started' },
      { type: 'turn.completed', usage: usage() },
    ]);
    await turn.done;
    expect(turn.fake.calls).toHaveLength(1);
    expect(turn.fake.calls[0].threadOptions).toMatchObject({
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      skipGitRepoCheck: true,
    });
  });

  it('reports credential presence without exposing any secret material', async () => {
    const home = await makeWorkspace();
    const bridge = new CodexBridge({
      factory: makeFakeCodex().bridge,
      codexHome: home,
      allowedEnv: {},
    });
    expect(await bridge.health()).toEqual({
      authenticated: false,
      detail: 'authentication_required',
    });

    await writeFile(join(home, 'auth.json'), '{"OPENAI_API_KEY":null}', 'utf8');
    expect(await bridge.health()).toEqual({
      authenticated: true,
      detail: 'available',
    });
  });
});

describe('Codex SDK bridge event normalization', () => {
  it('normalizes streamed Codex items and completion', async () => {
    const turn = await startStreamedTurn(fakeCodexStream());
    const collected = await turn.done.then(() => turn.collected);
    expect(collected).toEqual([
      { type: 'item.completed', payload: { kind: 'agent_message', text: 'working' } },
      { type: 'turn.completed', payload: { inputTokens: 10, outputTokens: 5 } },
    ]);
  });

  it('returns the final agent message as the turn response', async () => {
    const turn = await startStreamedTurn(fakeCodexStream());
    await expect(turn.done).resolves.toEqual({ finalResponse: 'working' });
  });

  it('never forwards raw reasoning, commands, or environment details', async () => {
    const stream: ThreadEvent[] = [
      { type: 'item.started', item: { id: 'r1', type: 'reasoning', text: 'secret thinking' } },
      {
        type: 'item.completed',
        item: {
          id: 'c1',
          type: 'command_execution',
          command: 'cat /etc/passwd',
          aggregated_output: 'root:…',
          status: 'completed',
        },
      },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'done' } },
      { type: 'turn.completed', usage: usage({ output_tokens: 1 }) },
    ];
    const turn = await startStreamedTurn(stream);
    const collected = await turn.done.then(() => turn.collected);
    expect(collected).toEqual([
      { type: 'item.completed', payload: { kind: 'agent_message', text: 'done' } },
      { type: 'turn.completed', payload: { inputTokens: 10, outputTokens: 1 } },
    ]);
  });

  it('fails the turn when the stream reports failure or a fatal error', async () => {
    const failed = await startStreamedTurn([
      { type: 'turn.failed', error: { message: 'quota exceeded' } },
    ]);
    await expect(failed.done).rejects.toThrow('quota exceeded');

    const errored = await startStreamedTurn([{ type: 'error', message: 'stream died' }]);
    await expect(errored.done).rejects.toThrow('stream died');
  });
});

describe('Codex SDK bridge sessions', () => {
  it('persists the Codex thread id inside the project workspace after the first turn', async () => {
    const workspace = await makeWorkspace();
    const fake = makeFakeCodex();
    fake.nextStream([
      { type: 'thread.started', thread_id: 'thread-abc' },
      { type: 'turn.completed', usage: usage() },
    ]);
    const bridge = new CodexBridge({
      factory: fake.bridge,
      codexHome: join(workspace, 'providers', 'codex'),
      allowedEnv: {},
    });
    const started = await bridge.startSession({
      projectId: PROJECT_ID,
      workingDirectory: workspace,
    });

    await bridge.runTurn(
      { runId: 'run-1', sessionId: started.sessionId, prompt: 'hello' },
      () => undefined,
    );

    const persisted = JSON.parse(
      await readFile(join(workspace, 'codex-sessions.json'), 'utf8'),
    ) as Record<string, string>;
    expect(persisted[started.sessionId]).toBe('thread-abc');
  });

  it('resumes through the persisted thread id on a brand-new bridge instance', async () => {
    const workspace = await makeWorkspace();
    const firstFake = makeFakeCodex();
    firstFake.nextStream([
      { type: 'thread.started', thread_id: 'thread-xyz' },
      { type: 'turn.completed', usage: usage() },
    ]);
    const firstBridge = new CodexBridge({
      factory: firstFake.bridge,
      codexHome: join(workspace, 'providers', 'codex'),
      allowedEnv: {},
    });
    const started = await firstBridge.startSession({
      projectId: PROJECT_ID,
      workingDirectory: workspace,
    });
    await firstBridge.runTurn(
      { runId: 'run-1', sessionId: started.sessionId, prompt: 'hello' },
      () => undefined,
    );

    const secondFake = makeFakeCodex();
    secondFake.nextStream([{ type: 'turn.completed', usage: usage() }]);
    const secondBridge = new CodexBridge({
      factory: secondFake.bridge,
      codexHome: join(workspace, 'providers', 'codex'),
      allowedEnv: {},
    });
    const resumeInput: ResumeSessionInput = {
      sessionId: started.sessionId,
      projectId: PROJECT_ID,
      workingDirectory: workspace,
    };
    await secondBridge.resumeSession(resumeInput);
    const completed = await secondBridge.runTurn(
      { runId: 'run-2', sessionId: started.sessionId, prompt: 'again' },
      () => undefined,
    );

    expect(secondFake.calls.map((call) => call.resumedId)).toEqual(['thread-xyz']);
    expect(secondFake.calls[0].threadOptions.workingDirectory).toBe(workspace);
    expect(completed.finalResponse).toBe('');
  });

  it('rejects resuming an unknown session instead of silently starting over', async () => {
    const workspace = await makeWorkspace();
    const bridge = new CodexBridge({
      factory: makeFakeCodex().bridge,
      codexHome: join(workspace, 'providers', 'codex'),
      allowedEnv: {},
    });
    const resumeInput: ResumeSessionInput = {
      sessionId: 'missing-session',
      projectId: PROJECT_ID,
      workingDirectory: workspace,
    };
    await expect(bridge.resumeSession(resumeInput)).rejects.toThrow('unknown_session');
  });

  it('aborts only the requested active run when cancelled', async () => {
    const workspace = await makeWorkspace();
    let observedSignal: AbortSignal | null = null;
    const hangingFactory: CodexFactory = () => ({
      startThread: (): Thread => ({
        runStreamed: (
          _input: unknown,
          turnOptions?: { signal?: AbortSignal },
        ) => ({
          events: (async function* generate(): AsyncGenerator<ThreadEvent> {
            observedSignal = turnOptions?.signal ?? null;
            yield { type: 'turn.started' };
            await new Promise<void>((resolve, reject) => {
              const signal = turnOptions?.signal;
              if (signal === undefined || signal.aborted) {
                reject(new Error('aborted'));
                return;
              }
              signal.addEventListener(
                'abort',
                () => reject(new Error('aborted')),
                { once: true },
              );
            });
            throw new Error('aborted');
          })(),
        }),
      } as unknown as Thread),
      resumeThread: (): Thread => {
        throw new Error('unexpected resume');
      },
    });
    const bridge = new CodexBridge({
      factory: hangingFactory,
      codexHome: join(workspace, 'providers', 'codex'),
      allowedEnv: {},
    });
    const started = await bridge.startSession({
      projectId: PROJECT_ID,
      workingDirectory: workspace,
    });

    const pending = bridge.runTurn(
      { runId: 'run-9', sessionId: started.sessionId, prompt: 'slow' },
      () => undefined,
    );

    expect(await bridge.cancel('run-other')).toBe(false);
    expect(await bridge.cancel('run-9')).toBe(true);
    await expect(pending).rejects.toThrow('aborted');
    expect(observedSignal?.aborted).toBe(true);
    expect(await bridge.cancel('run-9')).toBe(false);
  });
});
