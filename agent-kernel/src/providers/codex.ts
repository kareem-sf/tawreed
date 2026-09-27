import { randomUUID } from 'node:crypto';
import { access, constants, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Codex } from '@openai/codex-sdk';
import type {
  Thread,
  ThreadOptions,
} from '@openai/codex-sdk';
import type {
  ProviderBridge,
  ProviderEvent,
  ProviderHealth,
  ProviderSessionInput,
  ResumeSessionInput,
  RunTurnInput,
} from './types';

export type CodexFactory = (
  options: ConstructorParameters<typeof Codex>[0],
) => Pick<Codex, 'startThread' | 'resumeThread'>;

export interface CodexBridgeOptions {
  factory?: CodexFactory;
  codexHome: string;
  codexPath?: string;
  apiKey?: string;
  allowedEnv?: Record<string, string>;
}

const THREAD_BASE_OPTIONS: ThreadOptions = {
  skipGitRepoCheck: true,
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  networkAccessEnabled: false,
};

const SESSIONS_FILE = 'codex-sessions.json';
const MAX_PERSISTED_SESSIONS = 256;
const MAX_ID_CHARACTERS = 160;

interface SessionEntry {
  workingDirectory: string;
  codexThreadId: string | null;
  thread?: Thread;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function persistedSessionsFrom(raw: unknown): Map<string, string> {
  const sessions = new Map<string, string>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return sessions;
  for (const [sessionId, threadId] of Object.entries(raw as Record<string, unknown>)) {
    if (sessions.size >= MAX_PERSISTED_SESSIONS) break;
    if (
      sessionId.length === 0
      || sessionId.length > MAX_ID_CHARACTERS
      || typeof threadId !== 'string'
      || threadId.length === 0
      || threadId.length > MAX_ID_CHARACTERS
    ) continue;
    sessions.set(sessionId, threadId);
  }
  return sessions;
}

async function loadPersistedSessions(workingDirectory: string): Promise<Map<string, string>> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(workingDirectory, SESSIONS_FILE), 'utf8'),
    );
    return persistedSessionsFrom(raw);
  } catch {
    return new Map();
  }
}

export class CodexBridge implements ProviderBridge {
  readonly id = 'codex' as const;

  private readonly codex: Pick<Codex, 'startThread' | 'resumeThread'>;
  private readonly codexHome: string;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(options: CodexBridgeOptions) {
    this.codexHome = options.codexHome;
    const createCodex = options.factory ?? ((config) => new Codex(config));
    this.codex = createCodex({
      apiKey: options.apiKey,
      codexPathOverride: options.codexPath,
      env: { ...options.allowedEnv, CODEX_HOME: options.codexHome },
      config: { cli_auth_credentials_store: 'file' },
    });
  }

  async health(): Promise<ProviderHealth> {
    // Status only: presence of the provider-owned credential file under the
    // managed CODEX_HOME. Secret contents are never read.
    const authenticated = await fileExists(join(this.codexHome, 'auth.json'));
    return {
      authenticated,
      detail: authenticated ? 'available' : 'authentication_required',
    };
  }

  async startSession(input: ProviderSessionInput): Promise<{ sessionId: string }> {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      workingDirectory: input.workingDirectory,
      codexThreadId: null,
    });
    return { sessionId };
  }

  async resumeSession(input: ResumeSessionInput): Promise<void> {
    const existing = this.sessions.get(input.sessionId);
    if (existing !== undefined) {
      existing.workingDirectory = input.workingDirectory;
      return;
    }
    const persisted = await loadPersistedSessions(input.workingDirectory);
    const codexThreadId = persisted.get(input.sessionId);
    if (codexThreadId === undefined) throw new Error('unknown_session');
    this.sessions.set(input.sessionId, {
      workingDirectory: input.workingDirectory,
      codexThreadId,
    });
  }

  async runTurn(
    input: RunTurnInput,
    emit: (event: ProviderEvent) => void,
  ): Promise<{ finalResponse: string }> {
    const entry = this.sessions.get(input.sessionId);
    if (entry === undefined) throw new Error('unknown_session');
    const controller = new AbortController();
    this.activeRuns.set(input.runId, controller);
    try {
      let finalResponse = '';
      const streamed = await this.threadFor(entry).runStreamed(input.prompt, {
        ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
        signal: controller.signal,
      });
      for await (const event of streamed.events) {
        switch (event.type) {
          case 'thread.started':
            entry.codexThreadId = event.thread_id;
            await this.persistSessions(entry.workingDirectory);
            break;
          case 'item.completed':
            // Raw reasoning, commands, patches, tool calls, and web searches are
            // environment details; only the agent message reaches the host.
            if (event.item.type === 'agent_message') {
              finalResponse = event.item.text;
              emit({
                type: 'item.completed',
                payload: { kind: 'agent_message', text: event.item.text },
              });
            }
            break;
          case 'turn.completed':
            emit({
              type: 'turn.completed',
              payload: {
                inputTokens: event.usage.input_tokens,
                outputTokens: event.usage.output_tokens,
              },
            });
            break;
          case 'turn.failed':
            throw new Error(event.error.message);
          case 'error':
            throw new Error(event.message);
          default:
            break;
        }
      }
      return { finalResponse };
    } finally {
      this.activeRuns.delete(input.runId);
    }
  }

  async cancel(runId: string): Promise<boolean> {
    const controller = this.activeRuns.get(runId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  private threadFor(entry: SessionEntry): Thread {
    if (entry.thread === undefined) {
      const options: ThreadOptions = {
        ...THREAD_BASE_OPTIONS,
        workingDirectory: entry.workingDirectory,
      };
      entry.thread = entry.codexThreadId === null
        ? this.codex.startThread(options)
        : this.codex.resumeThread(entry.codexThreadId, options);
    }
    return entry.thread;
  }

  private async persistSessions(workingDirectory: string): Promise<void> {
    const persisted: Record<string, string> = {};
    for (const [sessionId, entry] of this.sessions) {
      if (entry.workingDirectory !== workingDirectory) continue;
      if (entry.codexThreadId === null) continue;
      if (Object.keys(persisted).length >= MAX_PERSISTED_SESSIONS) break;
      persisted[sessionId] = entry.codexThreadId;
    }
    await mkdir(workingDirectory, { recursive: true });
    await writeFile(
      join(workingDirectory, SESSIONS_FILE),
      `${JSON.stringify(persisted, null, 2)}\n`,
      'utf8',
    );
  }
}
