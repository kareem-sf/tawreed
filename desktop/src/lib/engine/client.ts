import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { MockEngine } from "./mockEngine";
import { engineMessageSchema, responsePayloadSchema } from "./schemas";
import type { EngineCommand, EngineListener, EngineMessage } from "./types";
import { PROTOCOL_VERSION } from "./types";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class EngineClient {
  private readonly native = isTauri();
  private readonly mock = this.native ? null : new MockEngine();
  private readonly listeners = new Set<EngineListener>();
  private readonly pending = new Map<string, PendingRequest>();
  private initializePromise: Promise<void> | null = null;

  initialize(): Promise<void> {
    if (this.initializePromise) {
      return this.initializePromise;
    }
    this.initializePromise = this.initializeInternal();
    return this.initializePromise;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    const mockUnsubscribe = this.mock?.subscribe(listener);
    return () => {
      this.listeners.delete(listener);
      mockUnsubscribe?.();
    };
  }

  async request<T>(
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    await this.initialize();
    if (this.mock) {
      return this.mock.request<T>(type, payload);
    }

    const requestId = crypto.randomUUID();
    const command: EngineCommand = {
      version: PROTOCOL_VERSION,
      type,
      requestId,
      payload,
    };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`The engine did not answer ${type} in time.`));
      }, 30_000);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      void invoke("engine_send", { command }).catch((reason: unknown) => {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(new Error(String(reason)));
      });
    });
  }

  async cancelRun(): Promise<void> {
    if (this.mock) {
      this.mock.cancel();
      return;
    }
    await invoke("engine_cancel");
  }

  private async initializeInternal(): Promise<void> {
    if (this.mock) {
      await this.mock.initialize();
      return;
    }
    await listen<unknown>("tawreed://engine-event", (event) => {
      this.handleMessage(event.payload);
    });
    await invoke("engine_start");
  }

  private handleMessage(raw: unknown): void {
    const parsed = engineMessageSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Rejected invalid engine message", parsed.error);
      return;
    }
    const message = parsed.data as EngineMessage;
    if (message.kind === "response" && message.requestId) {
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(message.requestId);
      const response = responsePayloadSchema.safeParse(message.payload);
      if (!response.success) {
        pending.reject(new Error("The engine returned an invalid response."));
      } else if (response.data.ok) {
        pending.resolve(response.data.data);
      } else {
        pending.reject(new Error(response.data.error.message));
      }
      return;
    }
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

export const engineClient = new EngineClient();
