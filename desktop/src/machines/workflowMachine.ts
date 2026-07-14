import { assign, setup } from "xstate";

import type {
  ApprovalRequest,
  RunProgress,
  SelectedWorkbook,
} from "../lib/engine/types";

export interface WorkflowContext {
  selectedFile: SelectedWorkbook | null;
  progress: RunProgress | null;
  approval: ApprovalRequest | null;
  outputPath: string | null;
  error: string | null;
}

export type WorkflowEvent =
  | { type: "SELECT_FILE"; file: SelectedWorkbook }
  | { type: "CLEAR_FILE" }
  | { type: "START" }
  | { type: "PROGRESS"; progress: RunProgress }
  | { type: "APPROVAL_REQUIRED"; request: ApprovalRequest }
  | { type: "APPROVE" }
  | { type: "COMPLETE"; outputPath: string }
  | { type: "FAIL"; message: string }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "RESET" };

const clearRun = {
  progress: null,
  approval: null,
  outputPath: null,
  error: null,
} satisfies Partial<WorkflowContext>;

export const workflowMachine = setup({
  types: {
    context: {} as WorkflowContext,
    events: {} as WorkflowEvent,
  },
}).createMachine({
  id: "tawreed-workflow",
  initial: "empty",
  context: {
    selectedFile: null,
    progress: null,
    approval: null,
    outputPath: null,
    error: null,
  },
  states: {
    empty: {
      on: {
        SELECT_FILE: {
          target: "ready",
          actions: assign(({ event }) => ({
            ...clearRun,
            selectedFile: event.file,
          })),
        },
      },
    },
    ready: {
      on: {
        SELECT_FILE: {
          actions: assign(({ event }) => ({
            ...clearRun,
            selectedFile: event.file,
          })),
        },
        CLEAR_FILE: {
          target: "empty",
          actions: assign({ selectedFile: null, ...clearRun }),
        },
        START: {
          target: "processing",
          actions: assign(clearRun),
        },
      },
    },
    processing: {
      on: {
        PROGRESS: {
          actions: assign(({ event }) => ({ progress: event.progress })),
        },
        APPROVAL_REQUIRED: {
          target: "approval",
          actions: assign(({ event }) => ({ approval: event.request })),
        },
        COMPLETE: {
          target: "complete",
          actions: assign(({ event }) => ({ outputPath: event.outputPath })),
        },
        FAIL: {
          target: "error",
          actions: assign(({ event }) => ({ error: event.message })),
        },
        CANCEL: { target: "ready", actions: assign(clearRun) },
      },
    },
    approval: {
      on: {
        APPROVE: { target: "exporting" },
        CANCEL: { target: "ready", actions: assign(clearRun) },
        FAIL: {
          target: "error",
          actions: assign(({ event }) => ({ error: event.message })),
        },
      },
    },
    exporting: {
      on: {
        PROGRESS: {
          actions: assign(({ event }) => ({ progress: event.progress })),
        },
        COMPLETE: {
          target: "complete",
          actions: assign(({ event }) => ({ outputPath: event.outputPath })),
        },
        FAIL: {
          target: "error",
          actions: assign(({ event }) => ({ error: event.message })),
        },
      },
    },
    complete: {
      on: {
        RESET: {
          target: "empty",
          actions: assign({ selectedFile: null, ...clearRun }),
        },
      },
    },
    error: {
      on: {
        RETRY: { target: "processing", actions: assign({ error: null }) },
        RESET: {
          target: "empty",
          actions: assign({ selectedFile: null, ...clearRun }),
        },
      },
    },
  },
});
