import { createActor } from "xstate";

import { workflowMachine } from "./workflowMachine";

const file = { path: "C:/BOQ.xlsx", name: "BOQ.xlsx" };

describe("workflowMachine", () => {
  it("enforces selection, processing, approval, and completion order", () => {
    const actor = createActor(workflowMachine).start();

    expect(actor.getSnapshot().value).toBe("empty");
    actor.send({ type: "SELECT_FILE", file });
    expect(actor.getSnapshot().value).toBe("ready");
    actor.send({ type: "START" });
    expect(actor.getSnapshot().value).toBe("processing");
    actor.send({
      type: "APPROVAL_REQUIRED",
      request: {
        token: "opaque-token",
        summary: {
          source_filename: "BOQ.xlsx",
          total_items: 2,
          package_counts: [["Concrete Works", 2]],
          warnings: [],
          provider: "Codex",
          model: "model",
        },
      },
    });
    expect(actor.getSnapshot().value).toBe("approval");
    actor.send({ type: "APPROVE" });
    expect(actor.getSnapshot().value).toBe("exporting");
    actor.send({ type: "COMPLETE", outputPath: "C:/Output.xlsx" });
    expect(actor.getSnapshot().value).toBe("complete");
    expect(actor.getSnapshot().context.outputPath).toBe("C:/Output.xlsx");
  });

  it("returns to the ready state on cancellation without losing the selected file", () => {
    const actor = createActor(workflowMachine).start();
    actor.send({ type: "SELECT_FILE", file });
    actor.send({ type: "START" });
    actor.send({ type: "CANCEL" });

    expect(actor.getSnapshot().value).toBe("ready");
    expect(actor.getSnapshot().context.selectedFile).toEqual(file);
    expect(actor.getSnapshot().context.approval).toBeNull();
  });
});
