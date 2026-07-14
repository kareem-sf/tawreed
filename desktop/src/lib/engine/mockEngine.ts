import type { EngineListener, EngineMessage } from "./types";
import { PROTOCOL_VERSION } from "./types";

const demoSettings = {
  provider: "Codex",
  model: "gpt-5.6-sol",
  model_id: "gpt-5.6-sol",
  base_url: "",
  language: "en",
  theme: "dark",
  has_api_key: false,
};

const demoHistory = [
  {
    id: 1,
    timestamp: "2026-07-12 20:56:00",
    project_name: "BOQ Master",
    packages_count: 12,
    output_path:
      "C:/Users/demo/.tawreed/outputs/BOQ_Master_Tawreed_Output.xlsx",
  },
];

export class MockEngine {
  private listeners = new Set<EngineListener>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private settings = { ...demoSettings };

  async initialize(): Promise<void> {
    this.emit("ready", {
      engine: "browser-mock",
      capabilities: ["boq_workflow"],
    });
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request<T>(
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    switch (type) {
      case "health":
        return { status: "ok", activeRun: this.timers.size > 0 } as T;
      case "get_settings":
        return { ...this.settings } as T;
      case "save_settings":
        this.settings = {
          ...this.settings,
          ...((payload.settings as Partial<typeof demoSettings>) ?? {}),
        };
        return { ...this.settings } as T;
      case "set_api_key":
        this.settings.has_api_key = Boolean(payload.api_key);
        return { has_api_key: this.settings.has_api_key } as T;
      case "get_history":
        return [...demoHistory] as T;
      case "delete_history":
        return { deleted: true } as T;
      case "refresh_models":
        return {
          provider: String(payload.provider ?? this.settings.provider),
          models: ["gpt-5.6-sol", "gpt-5.4"],
          source: "live",
          error: null,
          default_model: "gpt-5.6-sol",
        } as T;
      case "test_connection":
        return { success: true, message: "Codex is connected." } as T;
      case "start_run":
        this.scheduleRun();
        return { accepted: true } as T;
      case "approve_run":
        this.schedule(180, () =>
          this.emit("progress", {
            phase: "exporting",
            message: "Generating the approved workbook",
            current: null,
            total: null,
            elapsed_seconds: 7.2,
            cancellable: false,
          }),
        );
        this.schedule(900, () =>
          this.emit(
            "completed",
            "C:/Users/demo/.tawreed/outputs/BOQ_Master_Tawreed_Output.xlsx",
          ),
        );
        return { accepted: true } as T;
      case "cancel_run":
        this.clearTimers();
        this.emit("cancelled", {});
        return { cancelled: true } as T;
      default:
        throw new Error(`Mock engine does not support ${type}.`);
    }
  }

  cancel(): void {
    this.clearTimers();
    this.emit("cancelled", {});
  }

  private scheduleRun(): void {
    this.clearTimers();
    const progress = [
      [120, "inspecting", "Inspecting workbook structure", null, null],
      [650, "structuring", "Structuring 18 BOQ items", null, null],
      [1200, "classifying", "Classifying batch 1 of 1", 1, 1],
      [1850, "validating", "Validating exact item coverage", null, null],
    ] as const;
    for (const [delay, phase, message, current, total] of progress) {
      this.schedule(delay, () =>
        this.emit("progress", {
          phase,
          message,
          current,
          total,
          elapsed_seconds: delay / 1000,
          cancellable: true,
        }),
      );
    }
    this.schedule(2450, () =>
      this.emit("approval_required", {
        token: "browser-preview-token",
        summary: {
          source_filename: "BOQ_Master.xlsx",
          total_items: 18,
          package_counts: [
            ["Concrete Works", 2],
            ["Doors & Windows", 2],
            ["Electrical", 2],
            ["External Works", 2],
            ["Finishes", 2],
            ["HVAC", 2],
            ["General Requirements", 1],
            ["Low Current", 1],
            ["Masonry", 1],
            ["Other", 1],
            ["Plumbing", 1],
            ["Waterproofing", 1],
          ],
          warnings: [
            "1 item was assigned to Other; review it in Excel after export.",
          ],
          provider: "Codex",
          model: "gpt-5.6-sol",
        },
      }),
    );
  }

  private emit(kind: string, payload: unknown): void {
    const message: EngineMessage = { version: PROTOCOL_VERSION, kind, payload };
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private schedule(delay: number, callback: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
