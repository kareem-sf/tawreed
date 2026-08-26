import { createRequire } from 'node:module';
import type { infer as Infer } from 'zod';

const require = createRequire(import.meta.url);
const { z } = require('zod') as typeof import('zod');

export const PROTOCOL_VERSION = 1 as const;
export const MAX_INPUT_LINE_BYTES = 1024 * 1024;
export const MAX_PROMPT_BYTES = 256 * 1024;
export const MAX_OUTPUT_SCHEMA_BYTES = 256 * 1024;
export const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;
export const MAX_FINAL_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_EVENTS_PER_RUN = 512;
export const MAX_EVENT_BYTES_PER_RUN = 8 * 1024 * 1024;
export const MAX_SESSIONS = 256;
export const MAX_ACTIVE_RUNS = 64;
export const MAX_CONTROL_REQUESTS = 64;
export const MAX_CANCEL_REQUESTS = 64;
export const MAX_QUEUED_WRITER_BYTES = 16 * 1024 * 1024;
export const WRITER_EMERGENCY_RESERVED_BYTES = 64 * 1024;
export const WRITER_RESERVED_BYTES = MAX_FINAL_RESPONSE_BYTES + WRITER_EMERGENCY_RESERVED_BYTES;
export const MAX_SHORT_FIELD_CHARACTERS = 160;

export const providerIdSchema = z.enum(['codex', 'claude', 'gemini', 'compatible']);

export const errorCodeSchema = z.enum([
  'invalid_request',
  'method_not_found',
  'invalid_params',
  'not_initialized',
  'provider_unavailable',
  'project_context_invalid',
  'session_not_found',
  'session_conflict',
  'run_conflict',
  'capacity_exceeded',
  'agent_event_limit',
  'provider_failed',
  'internal_error',
]);
export type ErrorCode = Infer<typeof errorCodeSchema>;

export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  invalid_request: 'Invalid JSON-RPC request.',
  method_not_found: 'Method not found.',
  invalid_params: 'Invalid method parameters.',
  not_initialized: 'Kernel is not initialized.',
  provider_unavailable: 'Provider is unavailable.',
  project_context_invalid: 'Project context is invalid.',
  session_not_found: 'Session was not found.',
  session_conflict: 'Session does not match the requested context.',
  run_conflict: 'Run identifier is already active.',
  capacity_exceeded: 'Kernel capacity was exceeded.',
  agent_event_limit: 'Agent event limit was exceeded.',
  provider_failed: 'Provider operation failed.',
  internal_error: 'Internal kernel error.',
});

const safeIdSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const requestIdSchema = safeIdSchema;

function exceedsCodePointLimit(value: string, maximumCharacters: number): boolean {
  if (value.length <= maximumCharacters) return false;
  let characters = 0;
  const iterator = value[Symbol.iterator]();
  while (!iterator.next().done) {
    characters += 1;
    if (characters > maximumCharacters) return true;
  }
  return false;
}

function boundedString(maximumCharacters: number, maximumBytes: number, nonblank = true) {
  return z.string().superRefine((value, context) => {
    if (nonblank && value.trim().length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'blank string' });
    }
    if (
      exceedsCodePointLimit(value, maximumCharacters)
      || Buffer.byteLength(value, 'utf8') > maximumBytes
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'string limit' });
    }
  });
}

export const sessionIdSchema = boundedString(
  MAX_SHORT_FIELD_CHARACTERS,
  MAX_SHORT_FIELD_CHARACTERS * 4,
);
export const runIdSchema = sessionIdSchema;
export const eventTypeSchema = sessionIdSchema;

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const projectIdSchema = z.string().regex(canonicalUuidPattern);

function isJsonValue(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
  remaining = { nodes: 100_000 },
): boolean {
  remaining.nodes -= 1;
  if (remaining.nodes < 0 || depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => (
        typeof key !== 'string'
        || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
      ))) return false;
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) return false;
        if (!isJsonValue(value[index], ancestors, depth + 1, remaining)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || !Object.hasOwn(descriptor, 'value')
        || !isJsonValue(descriptor.value, ancestors, depth + 1, remaining)
      ) return false;
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

export function checkedJsonBytes(value: unknown): number | null {
  try {
    if (!isJsonValue(value)) return null;
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return null;
    const bytes = Buffer.byteLength(encoded, 'utf8');
    return Number.isSafeInteger(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

function boundedJsonValue(maximumBytes: number) {
  return z.unknown().superRefine((value, context) => {
    const bytes = checkedJsonBytes(value);
    if (bytes === null || bytes > maximumBytes) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON value limit' });
    }
  });
}

const outputSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  const bytes = checkedJsonBytes(value);
  if (bytes === null || bytes > MAX_OUTPUT_SCHEMA_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'output schema limit' });
  }
});

export const methodSchema = z.enum([
  'kernel.initialize',
  'kernel.health',
  'connections.status',
  'sessions.start',
  'sessions.resume',
  'turns.run',
  'turns.cancel',
]);
export type Method = Infer<typeof methodSchema>;

export const paramsSchemas = {
  'kernel.initialize': z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    appVersion: boundedString(MAX_SHORT_FIELD_CHARACTERS, 1024),
    dataDirectory: boundedString(4096, 16 * 1024),
  }).strict(),
  'kernel.health': z.object({}).strict(),
  'connections.status': z.object({}).strict(),
  'sessions.start': z.object({
    projectId: projectIdSchema,
    provider: providerIdSchema,
  }).strict(),
  'sessions.resume': z.object({
    projectId: projectIdSchema,
    provider: providerIdSchema,
    sessionId: sessionIdSchema,
  }).strict(),
  'turns.run': z.object({
    projectId: projectIdSchema,
    sessionId: sessionIdSchema,
    runId: runIdSchema,
    prompt: z.string().superRefine((value, context) => {
      if (value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > MAX_PROMPT_BYTES) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'prompt limit' });
      }
    }),
    outputSchema: outputSchema.optional(),
  }).strict(),
  'turns.cancel': z.object({ runId: runIdSchema }).strict(),
} as const;

export const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: safeIdSchema,
  method: boundedString(MAX_SHORT_FIELD_CHARACTERS, 1024),
  params: z.record(z.string(), z.unknown()),
}).strict();
export type RpcRequest = Infer<typeof requestSchema>;

const connectionResultSchema = z.object({
  providers: z.array(z.object({
    id: providerIdSchema,
    authenticated: z.boolean(),
    detail: boundedString(MAX_SHORT_FIELD_CHARACTERS, 1024),
  }).strict()).max(4),
}).strict();

const runResultSchema = z.object({
  runId: runIdSchema,
  finalResponse: boundedString(Number.MAX_SAFE_INTEGER, MAX_FINAL_RESPONSE_BYTES, false),
}).strict().superRefine((result, context) => {
  const bytes = checkedJsonBytes(result);
  if (bytes === null || bytes > MAX_FINAL_RESPONSE_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'final response limit' });
  }
});

export const resultSchema = z.union([
  z.object({ initialized: z.literal(true), protocolVersion: z.literal(PROTOCOL_VERSION) }).strict(),
  z.object({ status: z.literal('ok'), protocolVersion: z.literal(PROTOCOL_VERSION) }).strict(),
  connectionResultSchema,
  z.object({ sessionId: sessionIdSchema, provider: providerIdSchema }).strict(),
  z.object({
    sessionId: sessionIdSchema,
    provider: providerIdSchema,
    resumed: z.literal(true),
  }).strict(),
  runResultSchema,
  z.object({ runId: runIdSchema, cancelled: z.boolean() }).strict(),
]);
export type RpcResult = Infer<typeof resultSchema>;

const rpcErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
}).strict().superRefine((error, context) => {
  if (error.message !== ERROR_MESSAGES[error.code]) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'unexpected error message' });
  }
});

const successResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: safeIdSchema,
  result: resultSchema,
}).strict();
const errorResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([safeIdSchema, z.null()]),
  error: rpcErrorSchema,
}).strict().superRefine((response, context) => {
  if (response.id === null && response.error.code !== 'invalid_request') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'null id is reserved' });
  }
});
export const responseSchema = z.union([successResponseSchema, errorResponseSchema]);
export type RpcResponse = Infer<typeof responseSchema>;

export const providerEventSchema = z.object({
  type: eventTypeSchema,
  payload: boundedJsonValue(MAX_EVENT_PAYLOAD_BYTES),
});

export const notificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('agent.event'),
  params: z.object({
    runId: runIdSchema,
    type: eventTypeSchema,
    payload: boundedJsonValue(MAX_EVENT_PAYLOAD_BYTES),
  }).strict(),
}).strict();
export type AgentNotification = Infer<typeof notificationSchema>;

export function errorResponse(id: number | null, code: ErrorCode): RpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message: ERROR_MESSAGES[code] },
  };
}

export function successResponse(id: number, result: RpcResult): RpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export class KernelError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'KernelError';
  }
}

export class AgentEventLimitError extends KernelError {
  constructor() {
    super('agent_event_limit');
    this.name = 'AgentEventLimitError';
  }
}
