import type { ProviderBridge, ProviderId } from './providers/types';
import {
  AgentEventLimitError,
  KernelError,
  MAX_ACTIVE_RUNS,
  MAX_EVENT_BYTES_PER_RUN,
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_EVENTS_PER_RUN,
  MAX_FINAL_RESPONSE_BYTES,
  MAX_SESSIONS,
  checkedJsonBytes,
  errorResponse,
  methodSchema,
  notificationSchema,
  paramsSchemas,
  providerEventSchema,
  providerIdSchema,
  responseSchema,
  sessionIdSchema,
  successResponse,
  type AgentNotification,
  type ErrorCode,
  type RpcRequest,
  type RpcResponse,
  type RpcResult,
} from './protocol';
import {
  canonicalDataRoot,
  resolveProjectWorkspace,
  sameCanonicalPath,
} from './project-context';

export interface KernelLimits {
  maxSessions: number;
  maxActiveRuns: number;
  maxEventsPerRun: number;
  maxEventBytesPerRun: number;
  maxEventPayloadBytes: number;
  maxFinalResponseBytes: number;
}

const DEFAULT_LIMITS: KernelLimits = Object.freeze({
  maxSessions: MAX_SESSIONS,
  maxActiveRuns: MAX_ACTIVE_RUNS,
  maxEventsPerRun: MAX_EVENTS_PER_RUN,
  maxEventBytesPerRun: MAX_EVENT_BYTES_PER_RUN,
  maxEventPayloadBytes: MAX_EVENT_PAYLOAD_BYTES,
  maxFinalResponseBytes: MAX_FINAL_RESPONSE_BYTES,
});

export interface AgentKernelOptions {
  providers: ReadonlyMap<ProviderId, ProviderBridge>;
  environment?: Readonly<Record<string, string | undefined>>;
  limits?: Partial<KernelLimits>;
  projectWorkspaceResolver?: typeof resolveProjectWorkspace;
}

interface SessionState {
  providerId: ProviderId;
  projectId: string;
  workingDirectory: string;
}

type SessionIdentity = Pick<SessionState, 'providerId' | 'projectId'>;

interface ActiveRun {
  provider: ProviderBridge;
  eventCount: number;
  eventBytes: number;
  overflowed: boolean;
  acceptingEvents: boolean;
  cancelPromise: Promise<boolean> | null;
}

type NotificationSink = (notification: AgentNotification) => void;

function positiveLimit(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
}

function completeLimits(overrides: Partial<KernelLimits> | undefined): KernelLimits {
  return {
    maxSessions: positiveLimit(overrides?.maxSessions ?? DEFAULT_LIMITS.maxSessions, DEFAULT_LIMITS.maxSessions),
    maxActiveRuns: positiveLimit(
      overrides?.maxActiveRuns ?? DEFAULT_LIMITS.maxActiveRuns,
      DEFAULT_LIMITS.maxActiveRuns,
    ),
    maxEventsPerRun: positiveLimit(
      overrides?.maxEventsPerRun ?? DEFAULT_LIMITS.maxEventsPerRun,
      DEFAULT_LIMITS.maxEventsPerRun,
    ),
    maxEventBytesPerRun: positiveLimit(
      overrides?.maxEventBytesPerRun ?? DEFAULT_LIMITS.maxEventBytesPerRun,
      DEFAULT_LIMITS.maxEventBytesPerRun,
    ),
    maxEventPayloadBytes: positiveLimit(
      overrides?.maxEventPayloadBytes ?? DEFAULT_LIMITS.maxEventPayloadBytes,
      DEFAULT_LIMITS.maxEventPayloadBytes,
    ),
    maxFinalResponseBytes: positiveLimit(
      overrides?.maxFinalResponseBytes ?? DEFAULT_LIMITS.maxFinalResponseBytes,
      DEFAULT_LIMITS.maxFinalResponseBytes,
    ),
  };
}

function asKernelError(error: unknown, fallback: ErrorCode): KernelError {
  return error instanceof KernelError ? error : new KernelError(fallback);
}

export class AgentKernel {
  private readonly providers: ReadonlyMap<ProviderId, ProviderBridge>;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly limits: KernelLimits;
  private readonly projectWorkspaceResolver: typeof resolveProjectWorkspace;
  private readonly sessions = new Map<string, SessionState>();
  private readonly pendingSessionIds = new Map<string, SessionIdentity>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private pendingSessions = 0;
  private dataRoot: string | null = null;

  constructor(options: AgentKernelOptions) {
    this.providers = options.providers;
    this.environment = options.environment ?? process.env;
    this.limits = completeLimits(options.limits);
    this.projectWorkspaceResolver = options.projectWorkspaceResolver ?? resolveProjectWorkspace;
  }

  async dispatch(
    request: RpcRequest,
    emitNotification: NotificationSink = () => undefined,
  ): Promise<RpcResponse> {
    const method = methodSchema.safeParse(request.method);
    if (!method.success) return errorResponse(request.id, 'method_not_found');
    const params = paramsSchemas[method.data].safeParse(request.params);
    if (!params.success) return errorResponse(request.id, 'invalid_params');

    try {
      let result: RpcResult;
      switch (method.data) {
        case 'kernel.initialize':
          result = await this.initialize(params.data as {
            protocolVersion: 1;
            appVersion: string;
            dataDirectory: string;
          });
          break;
        case 'kernel.health':
          result = { status: 'ok', protocolVersion: 1 };
          break;
        case 'connections.status':
          this.requireInitialized();
          result = await this.connectionStatus();
          break;
        case 'sessions.start':
          this.requireInitialized();
          result = await this.startSession(params.data as {
            projectId: string;
            provider: ProviderId;
          });
          break;
        case 'sessions.resume':
          this.requireInitialized();
          result = await this.resumeSession(params.data as {
            projectId: string;
            provider: ProviderId;
            sessionId: string;
          });
          break;
        case 'turns.run':
          this.requireInitialized();
          result = await this.runTurn(params.data as {
            projectId: string;
            sessionId: string;
            runId: string;
            prompt: string;
            outputSchema?: Record<string, unknown>;
          }, emitNotification);
          break;
        case 'turns.cancel':
          this.requireInitialized();
          result = this.cancelRun((params.data as { runId: string }).runId);
          break;
      }
      return responseSchema.parse(successResponse(request.id, result));
    } catch (error) {
      const normalized = asKernelError(error, 'internal_error');
      return errorResponse(request.id, normalized.code);
    }
  }

  requestCancellationForActiveRuns(): void {
    for (const [runId, active] of [...this.activeRuns]) {
      this.cancelOnce(runId, active);
    }
  }

  private requireInitialized(): void {
    if (this.dataRoot === null) throw new KernelError('not_initialized');
  }

  private async initialize(params: {
    protocolVersion: 1;
    appVersion: string;
    dataDirectory: string;
  }): Promise<RpcResult> {
    const configuredRoot = this.environment.TAWREED_DATA_DIR;
    if (configuredRoot === undefined || configuredRoot.trim().length === 0) {
      throw new KernelError('invalid_params');
    }
    try {
      const [trustedRoot, assertedRoot] = await Promise.all([
        canonicalDataRoot(configuredRoot),
        canonicalDataRoot(params.dataDirectory),
      ]);
      if (!sameCanonicalPath(trustedRoot, assertedRoot)) throw new KernelError('invalid_params');
      if (this.dataRoot !== null && !sameCanonicalPath(this.dataRoot, trustedRoot)) {
        throw new KernelError('invalid_params');
      }
      this.dataRoot = trustedRoot;
      return { initialized: true, protocolVersion: 1 };
    } catch (error) {
      throw asKernelError(error, 'invalid_params');
    }
  }

  private validProvider(id: ProviderId): ProviderBridge | null {
    const provider = this.providers.get(id);
    return provider !== undefined && provider.id === id && providerIdSchema.safeParse(provider.id).success
      ? provider
      : null;
  }

  private async connectionStatus(): Promise<RpcResult> {
    const providers = [...this.providers.entries()]
      .filter(([id, provider]) => provider.id === id && providerIdSchema.safeParse(id).success)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 4);
    const summaries = await Promise.all(providers.map(async ([id, provider]) => {
      try {
        const health = await provider.health();
        if (typeof health?.authenticated !== 'boolean') throw new Error('invalid health');
        return {
          id,
          authenticated: health.authenticated,
          detail: health.authenticated ? 'available' : 'authentication_required',
        };
      } catch {
        return { id, authenticated: false, detail: 'unavailable' };
      }
    }));
    return { providers: summaries };
  }

  private reserveSession(): void {
    if (this.sessions.size + this.pendingSessions >= this.limits.maxSessions) {
      throw new KernelError('capacity_exceeded');
    }
    this.pendingSessions += 1;
  }

  private async workspace(projectId: string): Promise<string> {
    try {
      return await this.projectWorkspaceResolver(this.dataRoot as string, projectId);
    } catch {
      throw new KernelError('project_context_invalid');
    }
  }

  private async startSession(params: {
    projectId: string;
    provider: ProviderId;
  }): Promise<RpcResult> {
    const provider = this.validProvider(params.provider);
    if (provider === null) throw new KernelError('provider_unavailable');
    this.reserveSession();
    try {
      const workingDirectory = await this.workspace(params.projectId);
      let started: { sessionId: string };
      try {
        started = await provider.startSession({
          projectId: params.projectId,
          workingDirectory,
        });
      } catch {
        throw new KernelError('provider_failed');
      }
      const sessionId = sessionIdSchema.safeParse(started?.sessionId);
      if (!sessionId.success) throw new KernelError('provider_failed');
      if (this.sessions.has(sessionId.data) || this.pendingSessionIds.has(sessionId.data)) {
        throw new KernelError('session_conflict');
      }
      this.sessions.set(sessionId.data, {
        providerId: params.provider,
        projectId: params.projectId,
        workingDirectory,
      });
      return { sessionId: sessionId.data, provider: params.provider };
    } finally {
      this.pendingSessions -= 1;
    }
  }

  private async resumeSession(params: {
    projectId: string;
    provider: ProviderId;
    sessionId: string;
  }): Promise<RpcResult> {
    const provider = this.validProvider(params.provider);
    if (provider === null) throw new KernelError('provider_unavailable');
    const existing = this.sessions.get(params.sessionId);
    if (
      existing !== undefined
      && (existing.providerId !== params.provider || existing.projectId !== params.projectId)
    ) {
      throw new KernelError('session_conflict');
    }
    if (this.pendingSessionIds.has(params.sessionId)) throw new KernelError('session_conflict');
    if (existing === undefined) this.reserveSession();
    const reservation: SessionIdentity = {
      providerId: params.provider,
      projectId: params.projectId,
    };
    this.pendingSessionIds.set(params.sessionId, reservation);
    try {
      const workingDirectory = await this.workspace(params.projectId);
      try {
        await provider.resumeSession({
          sessionId: params.sessionId,
          projectId: params.projectId,
          workingDirectory,
        });
      } catch {
        throw new KernelError('provider_failed');
      }
      this.sessions.set(params.sessionId, {
        providerId: params.provider,
        projectId: params.projectId,
        workingDirectory,
      });
      return { sessionId: params.sessionId, provider: params.provider, resumed: true };
    } finally {
      if (this.pendingSessionIds.get(params.sessionId) === reservation) {
        this.pendingSessionIds.delete(params.sessionId);
      }
      if (existing === undefined) this.pendingSessions -= 1;
    }
  }

  private async runTurn(
    params: {
      projectId: string;
      sessionId: string;
      runId: string;
      prompt: string;
      outputSchema?: Record<string, unknown>;
    },
    emitNotification: NotificationSink,
  ): Promise<RpcResult> {
    const session = this.sessions.get(params.sessionId);
    if (session === undefined) throw new KernelError('session_not_found');
    if (session.projectId !== params.projectId) throw new KernelError('session_conflict');
    if (this.activeRuns.has(params.runId)) throw new KernelError('run_conflict');
    if (this.activeRuns.size >= this.limits.maxActiveRuns) {
      throw new KernelError('capacity_exceeded');
    }
    const provider = this.validProvider(session.providerId);
    if (provider === null) throw new KernelError('provider_unavailable');

    const active: ActiveRun = {
      provider,
      eventCount: 0,
      eventBytes: 0,
      overflowed: false,
      acceptingEvents: true,
      cancelPromise: null,
    };
    this.activeRuns.set(params.runId, active);
    const emit = (untrustedEvent: unknown) => {
      if (!active.acceptingEvents) return;
      if (active.overflowed) throw new AgentEventLimitError();
      const event = providerEventSchema.safeParse(untrustedEvent);
      if (!event.success) return this.rejectEvents(params.runId, active);
      const payloadBytes = checkedJsonBytes(event.data.payload);
      if (payloadBytes === null || payloadBytes > this.limits.maxEventPayloadBytes) {
        return this.rejectEvents(params.runId, active);
      }
      const notification = notificationSchema.parse({
        jsonrpc: '2.0',
        method: 'agent.event',
        params: {
          runId: params.runId,
          type: event.data.type,
          payload: event.data.payload,
        },
      });
      const eventBytes = checkedJsonBytes(notification);
      if (
        eventBytes === null
        || active.eventCount >= this.limits.maxEventsPerRun
        || active.eventBytes > this.limits.maxEventBytesPerRun - eventBytes
      ) {
        return this.rejectEvents(params.runId, active);
      }
      active.eventCount += 1;
      active.eventBytes += eventBytes;
      try {
        emitNotification(notification);
      } catch {
        return this.rejectEvents(params.runId, active);
      }
    };

    try {
      let completed: { finalResponse: string };
      try {
        completed = await provider.runTurn({
          runId: params.runId,
          sessionId: params.sessionId,
          prompt: params.prompt,
          ...(params.outputSchema === undefined ? {} : { outputSchema: params.outputSchema }),
        }, emit);
      } catch {
        if (active.overflowed) throw new AgentEventLimitError();
        throw new KernelError('provider_failed');
      }
      active.acceptingEvents = false;
      if (active.overflowed) throw new AgentEventLimitError();
      if (typeof completed?.finalResponse !== 'string') throw new KernelError('provider_failed');
      const result = { runId: params.runId, finalResponse: completed.finalResponse };
      const resultBytes = checkedJsonBytes(result);
      if (resultBytes === null || resultBytes > this.limits.maxFinalResponseBytes) {
        throw new KernelError('provider_failed');
      }
      return result;
    } finally {
      active.acceptingEvents = false;
      if (this.activeRuns.get(params.runId) === active) this.activeRuns.delete(params.runId);
    }
  }

  private rejectEvents(runId: string, active: ActiveRun): never {
    if (!active.overflowed) {
      active.overflowed = true;
      this.cancelOnce(runId, active);
    }
    throw new AgentEventLimitError();
  }

  private cancelRun(runId: string): RpcResult {
    const active = this.activeRuns.get(runId);
    if (active === undefined) return { runId, cancelled: false };
    this.cancelOnce(runId, active);
    return { runId, cancelled: true };
  }

  private cancelOnce(runId: string, active: ActiveRun): Promise<boolean> {
    if (active.cancelPromise === null) {
      try {
        active.cancelPromise = Promise.resolve(active.provider.cancel(runId)).then(
          (cancelled) => cancelled === true,
          () => false,
        );
      } catch {
        active.cancelPromise = Promise.resolve(false);
      }
      void active.cancelPromise.catch(() => undefined);
    }
    return active.cancelPromise;
  }
}
