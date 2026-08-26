import { spawnSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentKernel } from '../agent-kernel/src/kernel';
import {
  ERROR_MESSAGES,
  MAX_FINAL_RESPONSE_BYTES,
  MAX_OUTPUT_SCHEMA_BYTES,
  MAX_PROMPT_BYTES,
  PROTOCOL_VERSION,
  errorResponse,
  notificationSchema,
  paramsSchemas,
  requestSchema,
  responseSchema,
  successResponse,
  type RpcRequest,
  type RpcResponse,
} from '../agent-kernel/src/protocol';
import { resolveProjectWorkspace } from '../agent-kernel/src/project-context';
import { runProcessLoop } from '../agent-kernel/src/process-loop';
import type {
  ProviderBridge,
  ProviderEvent,
  ProviderId,
} from '../agent-kernel/src/providers/types';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECOND_PROJECT_ID = '123e4567-e89b-42d3-a456-426614174001';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function makeDataRoot(projectIds: string[] = [PROJECT_ID]) {
  const root = await mkdtemp(join(tmpdir(), 'tawreed-agent-test-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'projects'));
  for (const id of projectIds) {
    const project = join(root, 'projects', id);
    await mkdir(project);
    await writeFile(join(project, 'project.json'), JSON.stringify({ id }));
  }
  return root;
}

function makeProvider(
  overrides: Partial<ProviderBridge> & { id?: ProviderId } = {},
): ProviderBridge {
  let sessionSequence = 0;
  return {
    id: 'codex',
    health: async () => ({ authenticated: true, detail: 'connected' }),
    startSession: async () => ({ sessionId: `session-${++sessionSequence}` }),
    resumeSession: async () => undefined,
    runTurn: async () => ({ finalResponse: 'complete' }),
    cancel: async () => false,
    ...overrides,
  };
}

function request(id: number, method: string, params: Record<string, unknown>): RpcRequest {
  return requestSchema.parse({ jsonrpc: '2.0', id, method, params });
}

function resultOf(response: RpcResponse): unknown {
  if ('error' in response) throw new Error(`unexpected ${response.error.code}`);
  return response.result;
}

function errorCodeOf(response: RpcResponse): string {
  if ('result' in response) throw new Error('expected an error response');
  return response.error.code;
}

async function initialize(
  kernel: AgentKernel,
  dataDirectory: string,
  id = 1,
): Promise<RpcResponse> {
  return kernel.dispatch(request(id, 'kernel.initialize', {
    protocolVersion: PROTOCOL_VERSION,
    appVersion: '0.5.6',
    dataDirectory,
  }));
}

async function initializedKernel(
  providers: ProviderBridge[] = [],
  options: ConstructorParameters<typeof AgentKernel>[0] = { providers: new Map() },
) {
  const dataRoot = await makeDataRoot([PROJECT_ID, SECOND_PROJECT_ID]);
  const kernel = new AgentKernel({
    ...options,
    providers: new Map(providers.map((provider) => [provider.id, provider])),
    environment: { TAWREED_DATA_DIR: dataRoot },
  });
  expect(resultOf(await initialize(kernel, dataRoot))).toEqual({
    initialized: true,
    protocolVersion: PROTOCOL_VERSION,
  });
  return { dataRoot, kernel };
}

class CaptureWriter extends Writable {
  readonly chunks: Buffer[] = [];

  constructor(private readonly delayMs = 0) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.chunks.push(Buffer.from(chunk));
    if (this.delayMs > 0) setTimeout(callback, this.delayMs);
    else callback();
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function encodedRequest(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function parsedLines(writer: CaptureWriter): unknown[] {
  const text = writer.text();
  return text.length === 0
    ? []
    : text.trimEnd().split('\n').map((line) => JSON.parse(line) as unknown);
}

async function runLoop(
  kernel: AgentKernel,
  chunks: Array<Buffer | string>,
  options: Partial<Parameters<typeof runProcessLoop>[0]> = {},
) {
  const output = options.output instanceof CaptureWriter ? options.output : new CaptureWriter();
  const diagnostics = options.diagnostics instanceof CaptureWriter
    ? options.diagnostics
    : new CaptureWriter();
  const outcome = await runProcessLoop({
    input: Readable.from(chunks),
    output,
    diagnostics,
    kernel,
    ...options,
  });
  return { diagnostics, outcome, output, lines: parsedLines(output) };
}

describe('protocol v1 schemas', () => {
  it('accepts only nonnegative JavaScript-safe integer request ids', () => {
    for (const id of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(requestSchema.safeParse({ jsonrpc: '2.0', id, method: 'kernel.health', params: {} }).success)
        .toBe(true);
    }
    for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '1']) {
      expect(requestSchema.safeParse({ jsonrpc: '2.0', id, method: 'kernel.health', params: {} }).success)
        .toBe(false);
    }
  });

  it('rejects extra envelope fields and wrong JSON-RPC versions', () => {
    expect(requestSchema.safeParse({
      jsonrpc: '2.0', id: 1, method: 'kernel.health', params: {}, extra: true,
    }).success).toBe(false);
    expect(requestSchema.safeParse({
      jsonrpc: '1.0', id: 1, method: 'kernel.health', params: {},
    }).success).toBe(false);
  });

  it('keeps unknown bounded method names parseable for method-not-found dispatch', async () => {
    const parsed = requestSchema.parse({ jsonrpc: '2.0', id: 7, method: 'shell.run', params: {} });
    const kernel = new AgentKernel({ providers: new Map() });

    const response = await kernel.dispatch(parsed);

    expect(response).toEqual(errorResponse(7, 'method_not_found'));
  });

  it('requires exactly one strict result or allowlisted error', () => {
    expect(responseSchema.safeParse({
      jsonrpc: '2.0', id: 1,
      result: { status: 'ok', protocolVersion: 1 },
      error: { code: 'internal_error', message: ERROR_MESSAGES.internal_error },
    }).success).toBe(false);
    expect(responseSchema.safeParse({ jsonrpc: '2.0', id: 1 }).success).toBe(false);
    expect(responseSchema.safeParse({
      jsonrpc: '2.0', id: 1,
      result: { status: 'ok', protocolVersion: 1, extra: true },
    }).success).toBe(false);
    expect(responseSchema.safeParse(errorResponse(1, 'provider_failed')).success).toBe(true);
  });

  it('allows null ids only for invalid-request error responses', () => {
    expect(responseSchema.safeParse(errorResponse(null, 'invalid_request')).success).toBe(true);
    expect(responseSchema.safeParse(errorResponse(null, 'invalid_params')).success).toBe(false);
    expect(responseSchema.safeParse({
      jsonrpc: '2.0', id: null, result: { status: 'ok', protocolVersion: 1 },
    }).success).toBe(false);
  });

  it('uses one exact strict params schema for every method', () => {
    const valid: Record<keyof typeof paramsSchemas, Record<string, unknown>> = {
      'kernel.initialize': {
        protocolVersion: 1, appVersion: '0.5.6', dataDirectory: 'C:\\data',
      },
      'kernel.health': {},
      'connections.status': {},
      'sessions.start': { projectId: PROJECT_ID, provider: 'codex' },
      'sessions.resume': { projectId: PROJECT_ID, provider: 'codex', sessionId: 'session-1' },
      'turns.run': { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-1', prompt: 'Plan.' },
      'turns.cancel': { runId: 'run-1' },
    };

    for (const [method, params] of Object.entries(valid) as Array<[
      keyof typeof paramsSchemas,
      Record<string, unknown>,
    ]>) {
      expect(paramsSchemas[method].safeParse(params).success, method).toBe(true);
      expect(paramsSchemas[method].safeParse({ ...params, extra: true }).success, method).toBe(false);
    }
  });

  it('rejects noncanonical project ids and blank or oversized identifiers', () => {
    expect(paramsSchemas['sessions.start'].safeParse({
      projectId: PROJECT_ID.toUpperCase(), provider: 'codex',
    }).success).toBe(false);
    expect(paramsSchemas['sessions.start'].safeParse({
      projectId: '../../escape', provider: 'codex',
    }).success).toBe(false);
    for (const runId of ['', ' ', 'r'.repeat(161)]) {
      expect(paramsSchemas['turns.cancel'].safeParse({ runId }).success).toBe(false);
    }
  });

  it('enforces UTF-8 byte caps for prompts and output schemas', () => {
    const base = {
      projectId: PROJECT_ID,
      sessionId: 'session-1',
      runId: 'run-1',
    };
    expect(paramsSchemas['turns.run'].safeParse({
      ...base, prompt: 'é'.repeat(Math.floor(MAX_PROMPT_BYTES / 2)),
    }).success).toBe(true);
    expect(paramsSchemas['turns.run'].safeParse({
      ...base, prompt: `${'a'.repeat(MAX_PROMPT_BYTES)}b`,
    }).success).toBe(false);
    expect(paramsSchemas['turns.run'].safeParse({
      ...base,
      prompt: 'ok',
      outputSchema: { value: 'a'.repeat(MAX_OUTPUT_SCHEMA_BYTES) },
    }).success).toBe(false);
  });

  it('keeps notifications strict and provider identity out of the envelope', () => {
    expect(notificationSchema.parse({
      jsonrpc: '2.0',
      method: 'agent.event',
      params: { runId: 'run-1', type: 'progress', payload: { value: 1 } },
    })).toBeTruthy();
    expect(notificationSchema.safeParse({
      jsonrpc: '2.0',
      method: 'agent.event',
      params: { runId: 'run-1', type: 'progress', payload: {}, provider: 'codex' },
    }).success).toBe(false);
  });
});

describe('project context boundary', () => {
  it('creates only the final workspace inside an existing canonical project', async () => {
    const dataRoot = await makeDataRoot();

    const workspace = await resolveProjectWorkspace(dataRoot, PROJECT_ID);

    expect(workspace).toBe(await realpath(join(dataRoot, 'projects', PROJECT_ID, 'agent-workspace')));
    expect(relative(await realpath(join(dataRoot, 'projects')), workspace).startsWith('..')).toBe(false);
  });

  it('revalidates a concurrently created first workspace', async () => {
    const dataRoot = await makeDataRoot();

    const workspaces = await Promise.all(Array.from({ length: 8 }, () => (
      resolveProjectWorkspace(dataRoot, PROJECT_ID)
    )));

    expect(new Set(workspaces).size).toBe(1);
  });

  it('rejects traversal, noncanonical UUID spelling, and missing project roots', async () => {
    const dataRoot = await makeDataRoot();
    const missingRoot = join(dataRoot, 'missing');

    await expect(resolveProjectWorkspace(dataRoot, '../../escape')).rejects.toThrow('project_context_invalid');
    await expect(resolveProjectWorkspace(dataRoot, PROJECT_ID.toUpperCase()))
      .rejects.toThrow('project_context_invalid');
    await expect(resolveProjectWorkspace(missingRoot, PROJECT_ID))
      .rejects.toThrow('project_context_invalid');
    expect(await lstat(missingRoot).catch(() => null)).toBeNull();
  });

  it('rejects missing project records and non-directory project entries without repairing them', async () => {
    const dataRoot = await makeDataRoot([]);
    const projectPath = join(dataRoot, 'projects', PROJECT_ID);

    await expect(resolveProjectWorkspace(dataRoot, PROJECT_ID))
      .rejects.toThrow('project_context_invalid');
    expect(await lstat(projectPath).catch(() => null)).toBeNull();

    await writeFile(projectPath, 'not a directory');
    await expect(resolveProjectWorkspace(dataRoot, PROJECT_ID))
      .rejects.toThrow('project_context_invalid');
  });

  it('requires project.json to be a regular non-link file', async () => {
    const dataRoot = await makeDataRoot();
    const projectRecord = join(dataRoot, 'projects', PROJECT_ID, 'project.json');
    await rm(projectRecord);
    await mkdir(projectRecord);

    await expect(resolveProjectWorkspace(dataRoot, PROJECT_ID))
      .rejects.toThrow('project_context_invalid');
  });

  it('rejects a linked project.json entry', async () => {
    const dataRoot = await makeDataRoot();
    const projectPath = join(dataRoot, 'projects', PROJECT_ID);
    const projectRecord = join(projectPath, 'project.json');
    const linkedRecord = join(dataRoot, 'linked-project.json');
    await writeFile(linkedRecord, '{}');
    await rm(projectRecord);
    try {
      await symlink(linkedRecord, projectRecord, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || process.platform !== 'win32') {
        throw error;
      }
      await rm(linkedRecord);
      await mkdir(linkedRecord);
      await symlink(linkedRecord, projectRecord, 'junction');
    }

    expect((await lstat(projectRecord)).isSymbolicLink()).toBe(true);
    await expect(resolveProjectWorkspace(dataRoot, PROJECT_ID))
      .rejects.toThrow('project_context_invalid');
  });

  it('rejects linked project and workspace directories before writing outside', async () => {
    const dataRoot = await makeDataRoot([]);
    const outside = await mkdtemp(join(tmpdir(), 'tawreed-agent-outside-'));
    temporaryDirectories.push(outside);
    const projectPath = join(dataRoot, 'projects', PROJECT_ID);
    await symlink(outside, projectPath, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(resolveProjectWorkspace(dataRoot, PROJECT_ID))
      .rejects.toThrow('project_context_invalid');
    expect(await lstat(join(outside, 'agent-workspace')).catch(() => null)).toBeNull();

    await rm(projectPath);
    await mkdir(projectPath);
    await writeFile(join(projectPath, 'project.json'), '{}');
    await symlink(outside, join(projectPath, 'agent-workspace'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(resolveProjectWorkspace(dataRoot, PROJECT_ID))
      .rejects.toThrow('project_context_invalid');
  });
});

describe('agent kernel dispatch', () => {
  it('answers health without initialization or providers', async () => {
    const kernel = new AgentKernel({ providers: new Map() });

    const response = await kernel.dispatch(request(1, 'kernel.health', {}));

    expect(responseSchema.parse(response)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { status: 'ok', protocolVersion: PROTOCOL_VERSION },
    });
  });

  it('canonicalizes and matches the trusted host data directory assertion', async () => {
    const dataRoot = await makeDataRoot();
    const kernel = new AgentKernel({
      providers: new Map(),
      environment: { TAWREED_DATA_DIR: join(dataRoot, '.') },
    });

    expect(resultOf(await initialize(kernel, dataRoot))).toEqual({
      initialized: true,
      protocolVersion: PROTOCOL_VERSION,
    });

    const otherRoot = await makeDataRoot();
    const mismatch = new AgentKernel({
      providers: new Map(),
      environment: { TAWREED_DATA_DIR: dataRoot },
    });
    expect(errorCodeOf(await initialize(mismatch, otherRoot))).toBe('invalid_params');
  });

  it('requires initialization before provider and session methods', async () => {
    const kernel = new AgentKernel({ providers: new Map() });

    for (const [method, params] of [
      ['connections.status', {}],
      ['sessions.start', { projectId: PROJECT_ID, provider: 'codex' }],
      ['turns.cancel', { runId: 'run-1' }],
    ] as const) {
      expect(errorCodeOf(await kernel.dispatch(request(1, method, params)))).toBe('not_initialized');
    }
  });

  it('sorts connection summaries and replaces provider detail or failures with generic text', async () => {
    const leaked = `C:\\Users\\secret\\${'token'.repeat(20)}`;
    const providers = [
      makeProvider({ id: 'gemini', health: async () => { throw new Error(leaked); } }),
      makeProvider({ id: 'codex', health: async () => ({ authenticated: true, detail: leaked }) }),
      makeProvider({ id: 'claude', health: async () => ({ authenticated: false, detail: leaked }) }),
    ];
    const { kernel } = await initializedKernel(providers);

    const response = await kernel.dispatch(request(2, 'connections.status', {}));

    expect(resultOf(response)).toEqual({ providers: [
      { id: 'claude', authenticated: false, detail: 'authentication_required' },
      { id: 'codex', authenticated: true, detail: 'available' },
      { id: 'gemini', authenticated: false, detail: 'unavailable' },
    ] });
    expect(JSON.stringify(response)).not.toContain(leaked);
  });

  it('starts and resumes provider sessions with the project-owned workspace', async () => {
    const calls: Array<{ kind: string; projectId: string; workingDirectory: string }> = [];
    const provider = makeProvider({
      startSession: async (input) => {
        calls.push({ kind: 'start', ...input });
        return { sessionId: 'started-session' };
      },
      resumeSession: async (input) => {
        calls.push({ kind: 'resume', projectId: input.projectId, workingDirectory: input.workingDirectory });
      },
    });
    const { dataRoot, kernel } = await initializedKernel([provider]);

    expect(resultOf(await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID,
      provider: 'codex',
    })))).toEqual({ sessionId: 'started-session', provider: 'codex' });
    expect(resultOf(await kernel.dispatch(request(3, 'sessions.resume', {
      projectId: SECOND_PROJECT_ID,
      provider: 'codex',
      sessionId: 'resumed-session',
    })))).toEqual({ sessionId: 'resumed-session', provider: 'codex', resumed: true });

    expect(calls.map(({ kind, projectId }) => ({ kind, projectId }))).toEqual([
      { kind: 'start', projectId: PROJECT_ID },
      { kind: 'resume', projectId: SECOND_PROJECT_ID },
    ]);
    for (const call of calls) {
      expect(call.workingDirectory.startsWith(await realpath(join(dataRoot, 'projects')))).toBe(true);
      expect(call.workingDirectory.endsWith('agent-workspace')).toBe(true);
    }
  });

  it('normalizes unavailable providers and provider exceptions without leaking details', async () => {
    const leaked = '/private/provider/token';
    const failing = makeProvider({
      startSession: async () => { throw new Error(leaked); },
    });
    const { kernel } = await initializedKernel([failing]);

    expect(errorCodeOf(await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'gemini',
    })))).toBe('provider_unavailable');
    const response = await kernel.dispatch(request(3, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    expect(errorCodeOf(response)).toBe('provider_failed');
    expect(JSON.stringify(response)).not.toContain(leaked);
  });

  it('enforces the bounded session registry before calling another provider', async () => {
    let starts = 0;
    const provider = makeProvider({
      startSession: async () => ({ sessionId: `session-${++starts}` }),
    });
    const { kernel } = await initializedKernel([provider], {
      providers: new Map(),
      limits: { maxSessions: 1 },
    });

    expect(resultOf(await kernel.dispatch(request(3, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    })))).toEqual({ sessionId: 'session-1', provider: 'codex' });
    expect(errorCodeOf(await kernel.dispatch(request(4, 'sessions.start', {
      projectId: SECOND_PROJECT_ID, provider: 'codex',
    })))).toBe('capacity_exceeded');
    expect(starts).toBe(1);
  });

  it('enforces session provider and project consistency', async () => {
    const codex = makeProvider({ startSession: async () => ({ sessionId: 'session-1' }) });
    const gemini = makeProvider({ id: 'gemini' });
    const { kernel } = await initializedKernel([codex, gemini]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));

    expect(errorCodeOf(await kernel.dispatch(request(3, 'sessions.resume', {
      projectId: PROJECT_ID,
      provider: 'gemini',
      sessionId: 'session-1',
    })))).toBe('session_conflict');
    expect(errorCodeOf(await kernel.dispatch(request(4, 'turns.run', {
      projectId: SECOND_PROJECT_ID,
      sessionId: 'session-1',
      runId: 'run-1',
      prompt: 'Plan.',
    })))).toBe('session_conflict');
    expect(errorCodeOf(await kernel.dispatch(request(5, 'turns.run', {
      projectId: PROJECT_ID,
      sessionId: 'missing',
      runId: 'run-2',
      prompt: 'Plan.',
    })))).toBe('session_not_found');
  });

  it('reserves a session id across concurrent conflicting resumes', async () => {
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let resumeCalls = 0;
    const provider = makeProvider({
      resumeSession: async () => {
        resumeCalls += 1;
        if (resumeCalls === 1) {
          firstEntered.resolve();
          await releaseFirst.promise;
        }
      },
    });
    const { kernel } = await initializedKernel([provider]);
    const first = kernel.dispatch(request(2, 'sessions.resume', {
      projectId: PROJECT_ID,
      provider: 'codex',
      sessionId: 'shared-session',
    }));
    await firstEntered.promise;

    const conflicting = await kernel.dispatch(request(3, 'sessions.resume', {
      projectId: SECOND_PROJECT_ID,
      provider: 'codex',
      sessionId: 'shared-session',
    }));

    releaseFirst.resolve();
    expect(errorCodeOf(conflicting)).toBe('session_conflict');
    expect(resultOf(await first)).toEqual({
      sessionId: 'shared-session', provider: 'codex', resumed: true,
    });
    expect(resumeCalls).toBe(1);
  });

  it('passes the Tawreed-owned run id and ignores a provider-spoofed event id', async () => {
    let receivedRunId = '';
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async (input, emit) => {
        receivedRunId = input.runId;
        emit({
          runId: 'spoofed-run',
          type: 'progress',
          payload: { step: 1 },
        } as unknown as ProviderEvent);
        return { finalResponse: 'done' };
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const notifications: unknown[] = [];

    const response = await kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID,
      sessionId: 'session-1',
      runId: 'owned-run',
      prompt: 'Plan.',
    }), (notification) => notifications.push(notification));

    expect(receivedRunId).toBe('owned-run');
    expect(notifications).toEqual([{
      jsonrpc: '2.0',
      method: 'agent.event',
      params: { runId: 'owned-run', type: 'progress', payload: { step: 1 } },
    }]);
    expect(resultOf(response)).toEqual({ runId: 'owned-run', finalResponse: 'done' });
  });

  it('silently ignores provider events emitted after a turn has settled', async () => {
    let emitAfterSettlement!: (event: ProviderEvent) => void;
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async (_input, emit) => {
        emitAfterSettlement = emit;
        return { finalResponse: 'done' };
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const notifications: unknown[] = [];

    const response = await kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID,
      sessionId: 'session-1',
      runId: 'settled-run',
      prompt: 'Plan.',
    }), (notification) => notifications.push(notification));

    expect(resultOf(response)).toEqual({ runId: 'settled-run', finalResponse: 'done' });
    expect(() => emitAfterSettlement({ type: 'late', payload: { ignored: true } })).not.toThrow();
    expect(notifications).toEqual([]);
  });

  it('rejects duplicate and over-capacity runs then releases capacity in finally', async () => {
    const first = deferred<{ finalResponse: string }>();
    const started = deferred<void>();
    let calls = 0;
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async () => {
        calls += 1;
        if (calls === 1) {
          started.resolve();
          return first.promise;
        }
        return { finalResponse: 'recovered' };
      },
    });
    const { kernel } = await initializedKernel([provider], {
      providers: new Map(), limits: { maxActiveRuns: 1 },
    });
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const firstRun = kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-1', prompt: 'Plan.',
    }));
    await started.promise;

    expect(errorCodeOf(await kernel.dispatch(request(4, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-1', prompt: 'Again.',
    })))).toBe('run_conflict');
    expect(errorCodeOf(await kernel.dispatch(request(5, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-2', prompt: 'Other.',
    })))).toBe('capacity_exceeded');

    first.reject(new Error('private provider detail'));
    expect(errorCodeOf(await firstRun)).toBe('provider_failed');
    expect(resultOf(await kernel.dispatch(request(6, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-2', prompt: 'Retry.',
    })))).toEqual({ runId: 'run-2', finalResponse: 'recovered' });
  });

  it('cancels an active provider run exactly once and reports unknown runs deterministically', async () => {
    const turn = deferred<{ finalResponse: string }>();
    const started = deferred<void>();
    const cancelled: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async () => {
        started.resolve();
        return turn.promise;
      },
      cancel: async (runId) => {
        cancelled.push(runId);
        turn.resolve({ finalResponse: 'cancelled' });
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const running = kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-1', prompt: 'Plan.',
    }));
    await started.promise;

    expect(resultOf(await kernel.dispatch(request(4, 'turns.cancel', { runId: 'run-1' }))))
      .toEqual({ runId: 'run-1', cancelled: true });
    expect(resultOf(await kernel.dispatch(request(5, 'turns.cancel', { runId: 'missing' }))))
      .toEqual({ runId: 'missing', cancelled: false });
    expect(resultOf(await running)).toEqual({ runId: 'run-1', finalResponse: 'cancelled' });
    expect(cancelled).toEqual(['run-1']);
  });

  it('latches event-count overflow, cancels once, and wins even when the provider swallows emits', async () => {
    const cancellations: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async (_input, emit) => {
        for (let index = 0; index < 5; index += 1) {
          try {
            emit({ type: 'progress', payload: { index } });
          } catch {
            // A provider cannot turn an overflow into success by swallowing the sink error.
          }
        }
        return { finalResponse: 'provider tried to succeed' };
      },
      cancel: async (runId) => {
        cancellations.push(runId);
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider], {
      providers: new Map(), limits: { maxEventsPerRun: 2 },
    });
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const notifications: unknown[] = [];

    const response = await kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-overflow', prompt: 'Plan.',
    }), (notification) => notifications.push(notification));

    expect(errorCodeOf(response)).toBe('agent_event_limit');
    expect(notifications).toHaveLength(2);
    expect(cancellations).toEqual(['run-overflow']);
  });

  it('bounds encoded event bytes', async () => {
    const cancellations: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async (_input, emit) => {
        for (const payload of [{ value: 'x'.repeat(100) }, { value: 'y'.repeat(100) }]) {
          try {
            emit({ type: 'progress', payload });
          } catch {
            // Exercise the final overflow latch.
          }
        }
        return { finalResponse: 'ignored' };
      },
      cancel: async (runId) => {
        cancellations.push(runId);
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider], {
      providers: new Map(),
      limits: { maxEventBytesPerRun: 240, maxEventPayloadBytes: 200 },
    });
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));

    const response = await kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-bytes', prompt: 'Plan.',
    }), () => undefined);

    expect(errorCodeOf(response)).toBe('agent_event_limit');
    expect(cancellations).toEqual(['run-bytes']);
  });

  it('rejects a non-serializable event payload in a fresh run', async () => {
    const cancellations: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async (_input, emit) => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        try {
          emit({ type: 'progress', payload: cyclic });
        } catch {
          // Exercise the overflow latch after the non-serializable event itself is rejected.
        }
        return { finalResponse: 'ignored' };
      },
      cancel: async (runId) => {
        cancellations.push(runId);
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const notifications: unknown[] = [];

    const response = await kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID,
      sessionId: 'session-1',
      runId: 'run-cyclic',
      prompt: 'Plan.',
    }), (notification) => notifications.push(notification));

    expect(errorCodeOf(response)).toBe('agent_event_limit');
    expect(notifications).toEqual([]);
    expect(cancellations).toEqual(['run-cyclic']);
  });

  it('rejects oversized final provider responses with a generic error', async () => {
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async () => ({ finalResponse: 'x'.repeat(MAX_FINAL_RESPONSE_BYTES + 1) }),
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));

    const response = await kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-large', prompt: 'Plan.',
    }));

    expect(errorCodeOf(response)).toBe('provider_failed');
    expect(JSON.stringify(response)).not.toContain('x'.repeat(200));
  });

  it('bounds the encoded final result rather than only raw string bytes', async () => {
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async () => ({ finalResponse: '\u0000'.repeat(30) }),
    });
    const { kernel } = await initializedKernel([provider], {
      providers: new Map(), limits: { maxFinalResponseBytes: 128 },
    });
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));

    const response = await kernel.dispatch(request(3, 'turns.run', {
      projectId: PROJECT_ID, sessionId: 'session-1', runId: 'escaped-final', prompt: 'Plan.',
    }));

    expect(errorCodeOf(response)).toBe('provider_failed');
  });
});

describe('bounded concurrent NDJSON process loop', () => {
  it('recovers valid ids when possible and otherwise uses null for invalid JSON or envelopes', async () => {
    const kernel = new AgentKernel({ providers: new Map() });
    const leaked = 'private prompt must not reach diagnostics';
    const invalidEnvelope = {
      jsonrpc: '2.0', id: 8, method: 'kernel.health', params: {}, extra: leaked,
    };

    const { diagnostics, lines } = await runLoop(kernel, [
      Buffer.from(`{not json ${leaked}}\n`),
      encodedRequest(invalidEnvelope),
      encodedRequest({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER + 1, method: 'kernel.health', params: {} }),
      encodedRequest({ jsonrpc: '2.0', id: 9, method: 'kernel.health', params: {} }),
    ]);

    expect(lines).toEqual([
      errorResponse(null, 'invalid_request'),
      errorResponse(8, 'invalid_request'),
      errorResponse(null, 'invalid_request'),
      { jsonrpc: '2.0', id: 9, result: { status: 'ok', protocolVersion: 1 } },
    ]);
    expect(diagnostics.text()).not.toContain(leaked);
    expect(lines.every((line) => responseSchema.safeParse(line).success)).toBe(true);
  });

  it('handles fragmented and multiple input lines without interleaving output JSON', async () => {
    const kernel = new AgentKernel({ providers: new Map() });
    const first = encodedRequest({ jsonrpc: '2.0', id: 1, method: 'kernel.health', params: {} });
    const second = encodedRequest({ jsonrpc: '2.0', id: 2, method: 'unknown.method', params: {} });

    const { lines } = await runLoop(kernel, [
      first.subarray(0, 7),
      Buffer.concat([first.subarray(7), second.subarray(0, 3)]),
      second.subarray(3),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual({
      jsonrpc: '2.0', id: 1, result: { status: 'ok', protocolVersion: 1 },
    });
    expect(lines).toContainEqual(errorResponse(2, 'method_not_found'));
  });

  it('rejects invalid UTF-8 without terminating the loop', async () => {
    const kernel = new AgentKernel({ providers: new Map() });

    const { lines } = await runLoop(kernel, [
      Buffer.from([0xff, 0x0a]),
      encodedRequest({ jsonrpc: '2.0', id: 2, method: 'kernel.health', params: {} }),
    ]);

    expect(lines).toEqual([
      errorResponse(null, 'invalid_request'),
      { jsonrpc: '2.0', id: 2, result: { status: 'ok', protocolVersion: 1 } },
    ]);
  });

  it('discards one oversized line through newline then recovers the next request', async () => {
    const kernel = new AgentKernel({ providers: new Map() });
    const oversized = Buffer.from(`${'x'.repeat(300)}\n`);

    const { lines } = await runLoop(kernel, [
      oversized.subarray(0, 150),
      Buffer.concat([
        oversized.subarray(150),
        encodedRequest({ jsonrpc: '2.0', id: 3, method: 'kernel.health', params: {} }),
      ]),
    ], { maxInputLineBytes: 256 });

    expect(lines).toEqual([
      errorResponse(null, 'invalid_request'),
      { jsonrpc: '2.0', id: 3, result: { status: 'ok', protocolVersion: 1 } },
    ]);
  });

  it('processes cancel while a run is blocked and keeps every writer line valid', async () => {
    const turns = new Map<string, ReturnType<typeof deferred<{ finalResponse: string }>>>();
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: (input) => {
        const turn = deferred<{ finalResponse: string }>();
        turns.set(input.runId, turn);
        return turn.promise;
      },
      cancel: async (runId) => {
        turns.get(runId)?.resolve({ finalResponse: 'cancelled' });
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));

    const { lines, outcome } = await runLoop(kernel, [Buffer.concat([
      encodedRequest({
        jsonrpc: '2.0', id: 10, method: 'turns.run',
        params: { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-1', prompt: 'Plan.' },
      }),
      encodedRequest({ jsonrpc: '2.0', id: 11, method: 'turns.cancel', params: { runId: 'run-1' } }),
    ])]);

    expect(outcome.forced).toBe(false);
    expect(lines).toContainEqual({
      jsonrpc: '2.0', id: 11, result: { runId: 'run-1', cancelled: true },
    });
    expect(lines).toContainEqual({
      jsonrpc: '2.0', id: 10, result: { runId: 'run-1', finalResponse: 'cancelled' },
    });
    expect(lines.every((line) => responseSchema.safeParse(line).success)).toBe(true);
  });

  it('does not starve cancel behind all 64 active run slots', async () => {
    const turns = new Map<string, ReturnType<typeof deferred<{ finalResponse: string }>>>();
    const cancellations: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: (input) => {
        const turn = deferred<{ finalResponse: string }>();
        turns.set(input.runId, turn);
        return turn.promise;
      },
      cancel: async (runId) => {
        cancellations.push(runId);
        turns.get(runId)?.resolve({ finalResponse: 'cancelled' });
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const requests = Array.from({ length: 64 }, (_, index) => encodedRequest({
      jsonrpc: '2.0', id: 100 + index, method: 'turns.run',
      params: {
        projectId: PROJECT_ID,
        sessionId: 'session-1',
        runId: `run-${index}`,
        prompt: 'Plan.',
      },
    }));
    requests.push(encodedRequest({
      jsonrpc: '2.0', id: 999, method: 'turns.cancel', params: { runId: 'run-0' },
    }));

    const { lines, outcome } = await runLoop(kernel, [Buffer.concat(requests)]);

    expect(outcome.forced).toBe(false);
    expect(lines).toContainEqual({
      jsonrpc: '2.0', id: 999, result: { runId: 'run-0', cancelled: true },
    });
    expect(cancellations).toContain('run-0');
    expect(lines).toHaveLength(65);
  });

  it('rejects excess run work without consuming the cancel path', async () => {
    const turns = new Map<string, ReturnType<typeof deferred<{ finalResponse: string }>>>();
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: (input) => {
        const turn = deferred<{ finalResponse: string }>();
        turns.set(input.runId, turn);
        return turn.promise;
      },
      cancel: async (runId) => {
        turns.get(runId)?.resolve({ finalResponse: 'cancelled' });
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));

    const { lines } = await runLoop(kernel, [Buffer.concat([
      encodedRequest({
        jsonrpc: '2.0', id: 10, method: 'turns.run',
        params: { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-1', prompt: 'Plan.' },
      }),
      encodedRequest({
        jsonrpc: '2.0', id: 11, method: 'turns.run',
        params: { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-2', prompt: 'Plan.' },
      }),
      encodedRequest({ jsonrpc: '2.0', id: 12, method: 'turns.cancel', params: { runId: 'run-1' } }),
    ])], { maxRunRequests: 1 });

    expect(lines).toContainEqual(errorResponse(11, 'capacity_exceeded'));
    expect(lines).toContainEqual({
      jsonrpc: '2.0', id: 12, result: { runId: 'run-1', cancelled: true },
    });
  });

  it('bounds pending non-cancel control work independently', async () => {
    const provider = makeProvider({
      health: async () => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
        return { authenticated: true, detail: 'connected' };
      },
    });
    const { kernel } = await initializedKernel([provider]);

    const { lines } = await runLoop(kernel, [Buffer.concat([
      encodedRequest({ jsonrpc: '2.0', id: 20, method: 'connections.status', params: {} }),
      encodedRequest({ jsonrpc: '2.0', id: 21, method: 'connections.status', params: {} }),
    ])], { maxControlRequests: 1 });

    expect(lines).toContainEqual(errorResponse(21, 'capacity_exceeded'));
    expect(lines.some((line) => (
      typeof line === 'object' && line !== null && 'id' in line && line.id === 20 && 'result' in line
    ))).toBe(true);
  });

  it('serializes provider events before their matching response', async () => {
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async (_input, emit) => {
        emit({ type: 'progress', payload: { step: 1 } });
        emit({ type: 'progress', payload: { step: 2 } });
        return { finalResponse: 'done' };
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));

    const { lines } = await runLoop(kernel, [encodedRequest({
      jsonrpc: '2.0', id: 30, method: 'turns.run',
      params: { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'run-events', prompt: 'Plan.' },
    })]);

    expect(lines.map((line) => ('method' in (line as object) ? 'event' : 'response')))
      .toEqual(['event', 'event', 'response']);
    expect(notificationSchema.safeParse(lines[0]).success).toBe(true);
    expect(notificationSchema.safeParse(lines[1]).success).toBe(true);
    expect(responseSchema.safeParse(lines[2]).success).toBe(true);
  });

  it('caps queued writer bytes, cancels once, and still emits a terminal event-limit response', async () => {
    const cancellations: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async (_input, emit) => {
        for (let index = 0; index < 20; index += 1) {
          try {
            emit({ type: 'chunk', payload: { text: 'x'.repeat(120), index } });
          } catch {
            // The kernel must preserve the overflow latch.
          }
        }
        return { finalResponse: 'ignored' };
      },
      cancel: async (runId) => {
        cancellations.push(runId);
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const slowOutput = new CaptureWriter(10);

    const { lines, outcome } = await runLoop(kernel, [encodedRequest({
      jsonrpc: '2.0', id: 40, method: 'turns.run',
      params: { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'writer-overflow', prompt: 'Plan.' },
    })], {
      output: slowOutput,
      maxQueuedWriterBytes: 512,
      writerReservedBytes: 256,
    });

    expect(lines).toContainEqual(errorResponse(40, 'agent_event_limit'));
    expect(cancellations).toEqual(['writer-overflow']);
    expect(outcome.peakQueuedWriterBytes).toBeLessThanOrEqual(512);
  });

  it('reserves writer space before allocating each serialized response buffer', async () => {
    const firstWriteStarted = deferred<void>();
    let releaseFirstWrite = () => undefined;
    let writeCount = 0;
    const output = new class extends CaptureWriter {
      override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        this.chunks.push(Buffer.from(chunk));
        writeCount += 1;
        if (writeCount === 1) {
          let released = false;
          releaseFirstWrite = () => {
            if (!released) {
              released = true;
              callback();
            }
          };
          firstWriteStarted.resolve();
        } else {
          callback();
        }
      }
    }();
    const input = Buffer.concat([
      encodedRequest({ jsonrpc: '2.0', id: 45, method: 'kernel.health', params: {} }),
      encodedRequest({ jsonrpc: '2.0', id: 46, method: 'kernel.health', params: {} }),
    ]);
    const bufferFrom = vi.spyOn(Buffer, 'from');
    const serializedResponses = () => bufferFrom.mock.calls.filter(([value]) => (
      typeof value === 'string'
      && value.startsWith('{"jsonrpc":"2.0"')
      && value.endsWith('\n')
    ));
    let loop: ReturnType<typeof runProcessLoop> | null = null;

    try {
      loop = runProcessLoop({
        input: Readable.from([input]),
        output,
        diagnostics: new CaptureWriter(),
        kernel: new AgentKernel({ providers: new Map() }),
        maxQueuedWriterBytes: 128,
        writerReservedBytes: 1,
        shutdownGraceMs: 500,
      });
      await firstWriteStarted.promise;
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));

      expect(serializedResponses()).toHaveLength(1);

      releaseFirstWrite();
      const outcome = await loop;
      expect(outcome.forced).toBe(false);
      expect(serializedResponses()).toHaveLength(2);
      expect(parsedLines(output)).toHaveLength(2);
    } finally {
      releaseFirstWrite();
      if (loop !== null) await loop;
      bufferFrom.mockRestore();
    }
  });

  it('keeps ordinary responses out of reserved writer space while admitting cancel errors', async () => {
    const firstWriteStarted = deferred<void>();
    let releaseFirstWrite = () => undefined;
    let writeCount = 0;
    const output = new class extends CaptureWriter {
      override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        this.chunks.push(Buffer.from(chunk));
        writeCount += 1;
        if (writeCount === 1) {
          let released = false;
          releaseFirstWrite = () => {
            if (!released) {
              released = true;
              callback();
            }
          };
          firstWriteStarted.resolve();
        } else {
          callback();
        }
      }
    }();
    const input = Buffer.concat([
      ...[80, 81, 82].map((id) => encodedRequest({
        jsonrpc: '2.0', id, method: 'kernel.health', params: {},
      })),
      encodedRequest({
        jsonrpc: '2.0', id: 83, method: 'turns.cancel', params: { runId: 'unknown-run' },
      }),
    ]);
    const bufferFrom = vi.spyOn(Buffer, 'from');
    const serializedResponseIds = () => bufferFrom.mock.calls.flatMap(([value]) => {
      if (
        typeof value !== 'string'
        || !value.startsWith('{"jsonrpc":"2.0"')
        || !value.endsWith('\n')
      ) return [];
      const parsed = JSON.parse(value) as { id?: unknown };
      return typeof parsed.id === 'number' ? [parsed.id] : [];
    });
    let loop: ReturnType<typeof runProcessLoop> | null = null;

    try {
      loop = runProcessLoop({
        input: Readable.from([input]),
        output,
        diagnostics: new CaptureWriter(),
        kernel: new AgentKernel({ providers: new Map() }),
        maxQueuedWriterBytes: 220,
        writerReservedBytes: 100,
        shutdownGraceMs: 500,
      });
      await firstWriteStarted.promise;
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));

      const idsBeforeRelease = serializedResponseIds();
      expect(idsBeforeRelease.filter((id) => [80, 81, 82].includes(id))).toHaveLength(1);
      expect(idsBeforeRelease.filter((id) => id === 83)).toHaveLength(1);

      releaseFirstWrite();
      expect((await loop).forced).toBe(false);
    } finally {
      releaseFirstWrite();
      if (loop !== null) await loop;
      bufferFrom.mockRestore();
    }
  });

  it('cancels active runs at EOF and force-returns after bounded grace for an uncooperative provider', async () => {
    const started = deferred<void>();
    const cancellations: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async () => {
        started.resolve();
        return new Promise<{ finalResponse: string }>(() => undefined);
      },
      cancel: async (runId) => {
        cancellations.push(runId);
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    const before = Date.now();

    const { outcome } = await runLoop(kernel, [encodedRequest({
      jsonrpc: '2.0', id: 50, method: 'turns.run',
      params: { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'hung-run', prompt: 'Plan.' },
    })], { shutdownGraceMs: 20 });
    await started.promise;

    expect(outcome.forced).toBe(true);
    expect(Date.now() - before).toBeLessThan(500);
    expect(cancellations).toEqual(['hung-run']);
  });

  it('includes a blocked stdout flush inside the EOF grace deadline', async () => {
    let releaseWrite: (() => void) | undefined;
    const output = new class extends CaptureWriter {
      override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        this.chunks.push(Buffer.from(chunk));
        releaseWrite = callback;
      }
    }();
    const kernel = new AgentKernel({ providers: new Map() });
    const loop = runProcessLoop({
      input: Readable.from([encodedRequest({
        jsonrpc: '2.0', id: 55, method: 'kernel.health', params: {},
      })]),
      output,
      diagnostics: new CaptureWriter(),
      kernel,
      shutdownGraceMs: 20,
    });

    const observed = await Promise.race([
      loop,
      new Promise<null>((resolveDelay) => setTimeout(() => resolveDelay(null), 100)),
    ]);
    releaseWrite?.();
    await loop;

    expect(observed).not.toBeNull();
    expect(observed?.forced).toBe(true);
  });

  it('starts the EOF grace deadline when a trailing cancel response is writer-backpressured', async () => {
    const turn = deferred<{ finalResponse: string }>();
    const cancellations: string[] = [];
    const provider = makeProvider({
      startSession: async () => ({ sessionId: 'session-1' }),
      runTurn: async () => turn.promise,
      cancel: async (runId) => {
        cancellations.push(runId);
        turn.resolve({ finalResponse: 'cancelled' });
        return true;
      },
    });
    const { kernel } = await initializedKernel([provider]);
    await kernel.dispatch(request(2, 'sessions.start', {
      projectId: PROJECT_ID, provider: 'codex',
    }));
    let releaseFirstWrite = () => undefined;
    let writeCount = 0;
    const output = new class extends CaptureWriter {
      override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        this.chunks.push(Buffer.from(chunk));
        writeCount += 1;
        if (writeCount === 1) {
          let released = false;
          releaseFirstWrite = () => {
            if (!released) {
              released = true;
              callback();
            }
          };
        } else {
          callback();
        }
      }
    }();
    const input = Buffer.concat([
      ...[70, 71, 72].map((id) => encodedRequest({
        jsonrpc: '2.0', id, method: 'kernel.health', params: {},
      })),
      encodedRequest({
        jsonrpc: '2.0', id: 73, method: 'turns.run',
        params: {
          projectId: PROJECT_ID,
          sessionId: 'session-1',
          runId: 'blocked-run',
          prompt: 'Plan.',
        },
      }),
      encodedRequest({
        jsonrpc: '2.0', id: 74, method: 'turns.cancel', params: { runId: 'blocked-run' },
      }),
    ]);
    const loop = runProcessLoop({
      input: Readable.from([input]),
      output,
      diagnostics: new CaptureWriter(),
      kernel,
      maxQueuedWriterBytes: 220,
      writerReservedBytes: 100,
      shutdownGraceMs: 20,
    });

    const observed = await Promise.race([
      loop,
      new Promise<null>((resolveDelay) => setTimeout(() => resolveDelay(null), 150)),
    ]);
    releaseFirstWrite();
    await loop;

    expect(observed).not.toBeNull();
    expect(observed?.forced).toBe(true);
    expect(cancellations).toEqual(['blocked-run']);
  });

  it('forces bounded shutdown when the emergency writer lane is exhausted before EOF', async () => {
    let releaseFirstWrite = () => undefined;
    let writeCount = 0;
    const output = new class extends CaptureWriter {
      override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        this.chunks.push(Buffer.from(chunk));
        writeCount += 1;
        if (writeCount === 1) {
          let released = false;
          releaseFirstWrite = () => {
            if (!released) {
              released = true;
              callback();
            }
          };
        } else {
          callback();
        }
      }
    }();
    const loop = runProcessLoop({
      input: Readable.from(['{bad json}\n{still bad}\n']),
      output,
      diagnostics: new CaptureWriter(),
      kernel: new AgentKernel({ providers: new Map() }),
      maxQueuedWriterBytes: 128,
      writerReservedBytes: 64,
      shutdownGraceMs: 20,
    });

    const observed = await Promise.race([
      loop,
      new Promise<null>((resolveDelay) => setTimeout(() => resolveDelay(null), 150)),
    ]);
    releaseFirstWrite();
    await loop;

    expect(observed).not.toBeNull();
    expect(observed?.forced).toBe(true);
  });

  it('wakes an open input iterator when detached work saturates the writer', async () => {
    const startEntered = deferred<void>();
    const failStart = deferred<void>();
    const provider = makeProvider({
      startSession: async () => {
        startEntered.resolve();
        await failStart.promise;
        throw new Error('private provider failure');
      },
    });
    const { kernel } = await initializedKernel([provider]);
    let releaseFirstWrite = () => undefined;
    const output = new class extends CaptureWriter {
      override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        this.chunks.push(Buffer.from(chunk));
        let released = false;
        releaseFirstWrite = () => {
          if (!released) {
            released = true;
            callback();
          }
        };
      }
    }();
    const inputFinished = deferred<IteratorResult<Buffer | string>>();
    const firstChunk = Buffer.concat([
      Buffer.from('{bad json}\n'),
      encodedRequest({
        jsonrpc: '2.0', id: 92, method: 'sessions.start',
        params: { projectId: PROJECT_ID, provider: 'codex' },
      }),
    ]);
    let deliveredFirstChunk = false;
    const input: AsyncIterable<Buffer | string> = {
      [Symbol.asyncIterator](): AsyncIterator<Buffer | string> {
        return {
          next: () => {
            if (!deliveredFirstChunk) {
              deliveredFirstChunk = true;
              return Promise.resolve({ done: false, value: firstChunk });
            }
            return inputFinished.promise;
          },
          return: async () => ({ done: true, value: undefined }),
        };
      },
    };
    const loop = runProcessLoop({
      input,
      output,
      diagnostics: new CaptureWriter(),
      kernel,
      maxQueuedWriterBytes: 128,
      writerReservedBytes: 64,
      shutdownGraceMs: 20,
    });
    await startEntered.promise;
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    failStart.resolve();

    const observed = await Promise.race([
      loop,
      new Promise<null>((resolveDelay) => setTimeout(() => resolveDelay(null), 150)),
    ]);
    inputFinished.resolve({ done: true, value: undefined });
    releaseFirstWrite();
    await loop;

    expect(observed).not.toBeNull();
    expect(observed?.forced).toBe(true);
  });

  it('forces bounded shutdown instead of waiting inline when the cancel-task cap is exhausted', async () => {
    const firstCancel = deferred<RpcResponse>();
    class PendingCancelKernel extends AgentKernel {
      readonly cancelRequestIds: number[] = [];

      override async dispatch(rpcRequest: RpcRequest): Promise<RpcResponse> {
        if (rpcRequest.method !== 'turns.cancel') return super.dispatch(rpcRequest);
        this.cancelRequestIds.push(rpcRequest.id);
        if (this.cancelRequestIds.length === 1) return firstCancel.promise;
        return successResponse(rpcRequest.id, { runId: 'second', cancelled: false });
      }
    }
    const kernel = new PendingCancelKernel({ providers: new Map() });
    const input = Buffer.concat([
      encodedRequest({
        jsonrpc: '2.0', id: 90, method: 'turns.cancel', params: { runId: 'first' },
      }),
      encodedRequest({
        jsonrpc: '2.0', id: 91, method: 'turns.cancel', params: { runId: 'second' },
      }),
    ]);
    const loop = runProcessLoop({
      input: Readable.from([input]),
      output: new CaptureWriter(),
      diagnostics: new CaptureWriter(),
      kernel,
      maxCancelRequests: 1,
      shutdownGraceMs: 20,
    });

    const observed = await Promise.race([
      loop,
      new Promise<null>((resolveDelay) => setTimeout(() => resolveDelay(null), 150)),
    ]);
    firstCancel.resolve(successResponse(90, { runId: 'first', cancelled: false }));
    await loop;

    expect(observed).not.toBeNull();
    expect(observed?.forced).toBe(true);
    expect(kernel.cancelRequestIds).toEqual([90]);
  });

  it('attaches rejection handling to work that settles after forced EOF', async () => {
    const turn = deferred<{ finalResponse: string }>();
    const started = deferred<void>();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const provider = makeProvider({
        startSession: async () => ({ sessionId: 'session-1' }),
        runTurn: async () => {
          started.resolve();
          return turn.promise;
        },
        cancel: async () => true,
      });
      const { kernel } = await initializedKernel([provider]);
      await kernel.dispatch(request(2, 'sessions.start', {
        projectId: PROJECT_ID, provider: 'codex',
      }));
      const loop = runLoop(kernel, [encodedRequest({
        jsonrpc: '2.0', id: 60, method: 'turns.run',
        params: { projectId: PROJECT_ID, sessionId: 'session-1', runId: 'late-reject', prompt: 'Plan.' },
      })], { shutdownGraceMs: 5 });
      await started.promise;
      expect((await loop).outcome.forced).toBe(true);

      turn.reject(new Error('late private rejection'));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('deterministic runtime entrypoint', () => {
  it('runs health first with exact isolated stdout and empty stderr', async () => {
    const sourcePath = join(REPO_ROOT, 'agent-kernel', 'src', 'index.ts');
    expect((await readFile(sourcePath)).byteLength).toBeGreaterThan(0);
    const isolated = await mkdtemp(join(tmpdir(), 'tawreed-health-isolated-'));
    temporaryDirectories.push(isolated);
    const isolatedEntrypoint = join(isolated, 'index.mjs');
    await copyFile(sourcePath, isolatedEntrypoint);
    const health = spawnSync(process.execPath, [isolatedEntrypoint, '--health-check'], {
      cwd: isolated,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '', TAWREED_DATA_DIR: '' },
    });

    expect(health.status).toBe(0);
    expect(health.stdout).toBe('{"status":"ok","protocolVersion":1}\n');
    expect(health.stderr).toBe('');
  });
});
