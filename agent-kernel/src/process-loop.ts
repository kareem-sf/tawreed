import { TextDecoder } from 'node:util';
import type { Writable } from 'node:stream';
import { AgentKernel } from './kernel';
import {
  AgentEventLimitError,
  MAX_ACTIVE_RUNS,
  MAX_CANCEL_REQUESTS,
  MAX_CONTROL_REQUESTS,
  MAX_INPUT_LINE_BYTES,
  MAX_QUEUED_WRITER_BYTES,
  WRITER_EMERGENCY_RESERVED_BYTES,
  WRITER_RESERVED_BYTES,
  checkedJsonBytes,
  errorResponse,
  requestIdSchema,
  requestSchema,
  type AgentNotification,
  type RpcRequest,
  type RpcResponse,
} from './protocol';

export interface ProcessLoopOptions {
  input: AsyncIterable<Buffer | string>;
  output: Writable;
  diagnostics: Writable;
  kernel: AgentKernel;
  maxInputLineBytes?: number;
  maxRunRequests?: number;
  maxControlRequests?: number;
  maxCancelRequests?: number;
  maxQueuedWriterBytes?: number;
  writerReservedBytes?: number;
  shutdownGraceMs?: number;
}

export interface ProcessLoopOutcome {
  forced: boolean;
  peakQueuedWriterBytes: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, fallback)
    : fallback;
}

function serializeLine(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function serializedLineBytes(value: unknown): number {
  const jsonBytes = checkedJsonBytes(value);
  if (jsonBytes === null || jsonBytes >= Number.MAX_SAFE_INTEGER) {
    throw new Error('writer serialization failed');
  }
  return jsonBytes + 1;
}

type ResponseLane = 'normal' | 'terminal' | 'emergency';

class WriterSaturatedError extends Error {
  constructor() {
    super('writer saturated');
    this.name = 'WriterSaturatedError';
  }
}

class SerializedWriter {
  private tail = Promise.resolve();
  private queuedBytes = 0;
  private readonly spaceWaiters = new Set<() => void>();
  private failure: Error | null = null;
  private peakBytes = 0;
  private readonly emergencyReservedBytes: number;

  constructor(
    private readonly output: Writable,
    private readonly maximumBytes: number,
    private readonly reservedBytes: number,
  ) {
    this.emergencyReservedBytes = Math.min(
      WRITER_EMERGENCY_RESERVED_BYTES,
      reservedBytes,
    );
  }

  get peakQueuedBytes(): number {
    return this.peakBytes;
  }

  enqueueEvent(notification: AgentNotification): void {
    const bytes = serializeLine(notification);
    const eventMaximum = this.maximumFor('normal');
    if (
      this.failure !== null
      || bytes.length > eventMaximum
      || this.queuedBytes > eventMaximum - bytes.length
    ) {
      throw new AgentEventLimitError();
    }
    this.reserve(bytes.length);
    this.queueReserved(bytes);
  }

  async enqueueResponse(response: RpcResponse, lane: ResponseLane): Promise<void> {
    const byteLength = serializedLineBytes(response);
    const laneMaximum = this.maximumFor(lane);
    if (byteLength > laneMaximum) throw new Error('writer response limit');
    if (this.failure !== null) throw this.failure;
    if (lane === 'emergency' && this.queuedBytes > laneMaximum - byteLength) {
      throw new WriterSaturatedError();
    }
    while (this.queuedBytes > laneMaximum - byteLength) {
      if (this.failure !== null) throw this.failure;
      await new Promise<void>((resolveSpace) => this.spaceWaiters.add(resolveSpace));
    }
    if (this.failure !== null) throw this.failure;
    this.reserve(byteLength);
    try {
      const bytes = serializeLine(response);
      if (bytes.length !== byteLength) throw new Error('writer serialization changed');
      this.queueReserved(bytes);
    } catch (error) {
      this.release(byteLength);
      throw error;
    }
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure !== null) throw this.failure;
  }

  private reserve(bytes: number): void {
    this.queuedBytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.queuedBytes);
  }

  private maximumFor(lane: ResponseLane): number {
    if (lane === 'normal') return this.maximumBytes - this.reservedBytes;
    if (lane === 'terminal') return this.maximumBytes - this.emergencyReservedBytes;
    return this.maximumBytes;
  }

  private queueReserved(bytes: Buffer): void {
    const operation = this.tail.then(() => new Promise<void>((resolveWrite, rejectWrite) => {
      this.output.write(bytes, (error) => {
        if (error) rejectWrite(error);
        else resolveWrite();
      });
    }));
    this.tail = operation.then(
      () => this.release(bytes.length),
      (error: Error) => {
        this.failure = error;
        this.release(bytes.length);
      },
    );
  }

  private release(bytes: number): void {
    this.queuedBytes -= bytes;
    for (const waiter of this.spaceWaiters) waiter();
    this.spaceWaiters.clear();
  }
}

function recoverRequestId(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'id')) return null;
  const id = requestIdSchema.safeParse((value as { id?: unknown }).id);
  return id.success ? id.data : null;
}

function responseLane(request: RpcRequest, response: RpcResponse): ResponseLane {
  if ('error' in response || request.method === 'turns.cancel') return 'emergency';
  return request.method === 'turns.run' ? 'terminal' : 'normal';
}

function writeDiagnostic(diagnostics: Writable, message: string): void {
  try {
    diagnostics.write(`${message}\n`);
  } catch {
    // Diagnostics are best-effort and never replace protocol output.
  }
}

function waitWithin(tasks: Promise<unknown>[], timeoutMs: number): Promise<boolean> {
  if (tasks.length === 0) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolveWait(false);
      }
    }, timeoutMs);
    void Promise.allSettled(tasks).then(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolveWait(true);
      }
    });
  });
}

export async function runProcessLoop(options: ProcessLoopOptions): Promise<ProcessLoopOutcome> {
  const maxInputLineBytes = positiveInteger(options.maxInputLineBytes, MAX_INPUT_LINE_BYTES);
  const maxRunRequests = positiveInteger(options.maxRunRequests, MAX_ACTIVE_RUNS);
  const maxControlRequests = positiveInteger(options.maxControlRequests, MAX_CONTROL_REQUESTS);
  const maxCancelRequests = positiveInteger(options.maxCancelRequests, MAX_CANCEL_REQUESTS);
  const maxQueuedWriterBytes = positiveInteger(
    options.maxQueuedWriterBytes,
    MAX_QUEUED_WRITER_BYTES,
  );
  const requestedReserve = positiveInteger(options.writerReservedBytes, WRITER_RESERVED_BYTES);
  const writerReservedBytes = Math.min(requestedReserve, maxQueuedWriterBytes - 1);
  const shutdownGraceMs = positiveInteger(options.shutdownGraceMs, 2_000);
  const writer = new SerializedWriter(
    options.output,
    maxQueuedWriterBytes,
    writerReservedBytes,
  );
  const tasks = new Set<Promise<void>>();
  let activeRunRequests = 0;
  let activeControlRequests = 0;
  let activeCancelRequests = 0;
  let forcedByWriterBackpressure = false;
  let wakePendingInput: (() => void) | null = null;
  const forcedInput = Symbol('forced input');

  const requestForcedShutdown = () => {
    if (forcedByWriterBackpressure) return;
    forcedByWriterBackpressure = true;
    wakePendingInput?.();
  };

  const nextInputOrForced = async (iterator: AsyncIterator<Buffer | string>) => {
    if (forcedByWriterBackpressure) return forcedInput;
    let wakeInput!: () => void;
    const forced = new Promise<typeof forcedInput>((resolveForced) => {
      wakeInput = () => resolveForced(forcedInput);
      wakePendingInput = wakeInput;
    });
    try {
      return await Promise.race([Promise.resolve(iterator.next()), forced]);
    } finally {
      if (wakePendingInput === wakeInput) wakePendingInput = null;
    }
  };

  const execute = async (rpcRequest: RpcRequest) => {
    let response: RpcResponse;
    try {
      response = await options.kernel.dispatch(
        rpcRequest,
        (notification) => writer.enqueueEvent(notification),
      );
    } catch {
      response = errorResponse(rpcRequest.id, 'internal_error');
    }
    await writer.enqueueResponse(response, responseLane(rpcRequest, response));
  };

  const launch = (rpcRequest: RpcRequest, kind: 'run' | 'control' | 'cancel') => {
    if (kind === 'run') activeRunRequests += 1;
    else if (kind === 'control') activeControlRequests += 1;
    else activeCancelRequests += 1;
    const task = execute(rpcRequest).catch((error: unknown) => {
      if (error instanceof WriterSaturatedError) requestForcedShutdown();
      writeDiagnostic(options.diagnostics, 'Agent response write failed.');
    });
    tasks.add(task);
    void task.finally(() => {
      if (kind === 'run') activeRunRequests -= 1;
      else if (kind === 'control') activeControlRequests -= 1;
      else activeCancelRequests -= 1;
      tasks.delete(task);
    });
  };

  const handleLine = async (line: Buffer) => {
    let decoded: string;
    let value: unknown;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(line);
      value = JSON.parse(decoded) as unknown;
    } catch {
      writeDiagnostic(options.diagnostics, 'Invalid agent request.');
      await writer.enqueueResponse(errorResponse(null, 'invalid_request'), 'emergency');
      return;
    }
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) {
      writeDiagnostic(options.diagnostics, 'Invalid agent request envelope.');
      await writer.enqueueResponse(
        errorResponse(recoverRequestId(value), 'invalid_request'),
        'emergency',
      );
      return;
    }

    if (parsed.data.method === 'turns.cancel') {
      if (activeCancelRequests >= maxCancelRequests) {
        requestForcedShutdown();
        writeDiagnostic(options.diagnostics, 'Agent response capacity was exhausted.');
        return;
      }
      launch(parsed.data, 'cancel');
      return;
    }
    if (parsed.data.method === 'turns.run') {
      if (activeRunRequests >= maxRunRequests) {
        await writer.enqueueResponse(
          errorResponse(parsed.data.id, 'capacity_exceeded'),
          'emergency',
        );
      } else {
        launch(parsed.data, 'run');
      }
      return;
    }
    if (activeControlRequests >= maxControlRequests) {
      await writer.enqueueResponse(
        errorResponse(parsed.data.id, 'capacity_exceeded'),
        'emergency',
      );
    } else {
      launch(parsed.data, 'control');
    }
  };

  const lineBuffer = Buffer.allocUnsafe(maxInputLineBytes);
  let lineLength = 0;
  let discarding = false;
  const inputIterator = options.input[Symbol.asyncIterator]();
  let inputFinished = false;
  try {
    while (!forcedByWriterBackpressure) {
      const nextInput = await nextInputOrForced(inputIterator);
      if (nextInput === forcedInput) break;
      if (nextInput.done) {
        inputFinished = true;
        break;
      }
      const inputChunk = nextInput.value;
      const chunk = typeof inputChunk === 'string' ? Buffer.from(inputChunk) : Buffer.from(inputChunk);
      let cursor = 0;
      while (cursor < chunk.length) {
        if (forcedByWriterBackpressure) break;
        const newline = chunk.indexOf(0x0a, cursor);
        const end = newline === -1 ? chunk.length : newline;
        if (discarding) {
          if (newline === -1) break;
          discarding = false;
          cursor = newline + 1;
          continue;
        }

        const segmentLength = end - cursor;
        if (lineLength > maxInputLineBytes - segmentLength) {
          lineLength = 0;
          discarding = newline === -1;
          writeDiagnostic(options.diagnostics, 'Oversized agent request.');
          await writer.enqueueResponse(errorResponse(null, 'invalid_request'), 'emergency');
          if (newline === -1) break;
          cursor = newline + 1;
          continue;
        }
        chunk.copy(lineBuffer, lineLength, cursor, end);
        lineLength += segmentLength;
        if (newline === -1) break;

        const contentLength = lineLength > 0 && lineBuffer[lineLength - 1] === 0x0d
          ? lineLength - 1
          : lineLength;
        await handleLine(Buffer.from(lineBuffer.subarray(0, contentLength)));
        lineLength = 0;
        cursor = newline + 1;
      }
    }

    if (!forcedByWriterBackpressure && !discarding && lineLength > 0) {
      await handleLine(Buffer.from(lineBuffer.subarray(0, lineLength)));
    }
  } catch (error) {
    if (!(error instanceof WriterSaturatedError)) throw error;
    requestForcedShutdown();
    writeDiagnostic(options.diagnostics, 'Agent response capacity was exhausted.');
  } finally {
    if (!inputFinished && typeof inputIterator.return === 'function') {
      try {
        void Promise.resolve(inputIterator.return()).catch(() => undefined);
      } catch {
        // Input shutdown is best-effort; the bounded process grace still applies.
      }
    }
  }

  options.kernel.requestCancellationForActiveRuns();
  const shutdownDeadline = Date.now() + shutdownGraceMs;
  const tasksDrained = await waitWithin([...tasks], shutdownGraceMs);
  let writerDrained = false;
  if (tasksDrained) {
    const flush = writer.flush();
    writerDrained = await waitWithin(
      [flush],
      Math.max(0, shutdownDeadline - Date.now()),
    );
    if (writerDrained) {
      try {
        await flush;
      } catch {
        writeDiagnostic(options.diagnostics, 'Agent writer shutdown failed.');
      }
    }
  }
  if (forcedByWriterBackpressure || !tasksDrained || !writerDrained) {
    return { forced: true, peakQueuedWriterBytes: writer.peakQueuedBytes };
  }
  return { forced: false, peakQueuedWriterBytes: writer.peakQueuedBytes };
}
