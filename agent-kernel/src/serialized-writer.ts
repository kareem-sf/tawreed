import type { Writable } from 'node:stream';
import {
  AgentEventLimitError,
  WRITER_EMERGENCY_RESERVED_BYTES,
  checkedJsonBytes,
  type AgentNotification,
  type RpcResponse,
} from './protocol';

export type ResponseLane = 'normal' | 'health' | 'terminal' | 'emergency';

export class WriterSaturatedError extends Error {
  constructor() {
    super('writer saturated');
    this.name = 'WriterSaturatedError';
  }
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

export class SerializedWriter {
  private tail = Promise.resolve();
  private queuedBytes = 0;
  private readonly spaceWaiters = new Set<() => void>();
  private failure: Error | null = null;
  private activeWriteReject: ((error: Error) => void) | null = null;
  private closed = false;
  private disposeRequested = false;
  private physicalWritePending = false;
  private callbackErrorAwaitingEvent = false;
  private errorEventGeneration = 0;
  private callbackErrorGeneration = 0;
  private peakBytes = 0;
  private readonly emergencyReservedBytes: number;
  private readonly outputErrorHandler = (error: Error) => {
    this.errorEventGeneration += 1;
    if (
      this.callbackErrorAwaitingEvent
      && this.errorEventGeneration > this.callbackErrorGeneration
    ) {
      this.callbackErrorAwaitingEvent = false;
    }
    this.latchFailure(error);
    this.maybeRemoveErrorListener();
  };

  constructor(
    private readonly output: Writable,
    private readonly maximumBytes: number,
    private readonly reservedBytes: number,
    private readonly onFailure: () => void,
  ) {
    this.emergencyReservedBytes = Math.min(
      WRITER_EMERGENCY_RESERVED_BYTES,
      reservedBytes,
    );
    this.output.on('error', this.outputErrorHandler);
  }

  get peakQueuedBytes(): number {
    return this.peakBytes;
  }

  enqueueEvent(notification: AgentNotification): void {
    const bytes = serializeLine(notification);
    const eventMaximum = this.maximumFor('normal');
    if (
      this.closed
      || this.failure !== null
      || bytes.length > eventMaximum
      || this.queuedBytes > eventMaximum - bytes.length
    ) {
      throw new AgentEventLimitError();
    }
    this.reserve(bytes.length);
    this.queueReserved(bytes);
  }

  async enqueueResponse(response: RpcResponse, lane: ResponseLane): Promise<void> {
    if (this.closed) throw this.failure ?? new Error('writer closed');
    const byteLength = serializedLineBytes(response);
    const laneMaximum = this.maximumFor(lane);
    if (byteLength > laneMaximum) throw new Error('writer response limit');
    if (this.failure !== null) throw this.failure;
    if (
      (lane === 'emergency' || lane === 'health')
      && this.queuedBytes > laneMaximum - byteLength
    ) {
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

  async abort(): Promise<void> {
    this.closed = true;
    this.latchFailure(new Error('writer aborted'));
    await this.tail;
  }

  dispose(): void {
    this.closed = true;
    this.disposeRequested = true;
    this.maybeRemoveErrorListener();
  }

  private reserve(bytes: number): void {
    this.queuedBytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.queuedBytes);
  }

  private maximumFor(lane: ResponseLane): number {
    if (lane === 'normal' || lane === 'health') {
      return this.maximumBytes - this.reservedBytes;
    }
    if (lane === 'terminal') return this.maximumBytes - this.emergencyReservedBytes;
    return this.maximumBytes;
  }

  private queueReserved(bytes: Buffer): void {
    const operation = this.tail.then(() => {
      if (this.failure !== null) throw this.failure;
      return this.write(bytes);
    });
    this.tail = operation.then(
      () => this.release(bytes.length),
      (error: unknown) => {
        this.latchFailure(error);
        this.release(bytes.length);
      },
    );
  }

  private write(bytes: Buffer): Promise<void> {
    return new Promise((resolveWrite, rejectWrite) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (this.activeWriteReject === rejectActiveWrite) this.activeWriteReject = null;
        if (error === undefined) resolveWrite();
        else rejectWrite(error);
      };
      const rejectActiveWrite = (error: Error) => settle(error);
      this.activeWriteReject = rejectActiveWrite;
      if (this.failure !== null) {
        settle(this.failure);
        return;
      }
      this.physicalWritePending = true;
      this.callbackErrorAwaitingEvent = false;
      try {
        this.output.write(bytes, (error) => {
          this.physicalWritePending = false;
          if (error) {
            this.callbackErrorAwaitingEvent = true;
            this.callbackErrorGeneration = this.errorEventGeneration;
            settle(this.latchFailure(error));
          } else {
            this.callbackErrorAwaitingEvent = false;
            settle();
          }
          this.maybeRemoveErrorListener();
        });
      } catch (error) {
        this.physicalWritePending = false;
        this.callbackErrorAwaitingEvent = false;
        settle(this.latchFailure(error));
        this.maybeRemoveErrorListener();
      }
    });
  }

  private latchFailure(error: unknown): Error {
    if (this.failure === null) {
      this.failure = error instanceof Error ? error : new Error('writer failure');
      this.activeWriteReject?.(this.failure);
      this.wakeSpaceWaiters();
      this.onFailure();
    }
    return this.failure;
  }

  private release(bytes: number): void {
    this.queuedBytes -= bytes;
    this.wakeSpaceWaiters();
  }

  private wakeSpaceWaiters(): void {
    for (const waiter of this.spaceWaiters) waiter();
    this.spaceWaiters.clear();
  }

  private maybeRemoveErrorListener(): void {
    if (
      this.disposeRequested
      && !this.physicalWritePending
      && !this.callbackErrorAwaitingEvent
    ) {
      this.output.off('error', this.outputErrorHandler);
    }
  }
}
