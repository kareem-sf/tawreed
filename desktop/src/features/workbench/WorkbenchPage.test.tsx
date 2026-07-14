import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { tawreedTheme } from "../../app/theme";
import type { WorkflowContext } from "../../machines/workflowMachine";
import { WorkbenchPage } from "./WorkbenchPage";

const emptyContext: WorkflowContext = {
  selectedFile: null,
  progress: null,
  approval: null,
  outputPath: null,
  error: null,
};

function renderPage(context: WorkflowContext = emptyContext) {
  const props = {
    status: context.selectedFile ? ("ready" as const) : ("empty" as const),
    context,
    onBrowse: vi.fn(),
    onSelectFile: vi.fn(),
    onStart: vi.fn(),
    onApprove: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onReset: vi.fn(),
    onOpenOutput: vi.fn(),
    onRevealOutput: vi.fn(),
  };
  render(
    <MantineProvider theme={tawreedTheme} defaultColorScheme="dark">
      <WorkbenchPage {...props} />
    </MantineProvider>,
  );
  return props;
}

describe("WorkbenchPage", () => {
  it("opens the workbook chooser from the accessible dropzone", () => {
    const props = renderPage();
    fireEvent.keyDown(
      screen.getByRole("button", { name: /choose workbook/i }),
      {
        key: "Enter",
      },
    );
    expect(props.onBrowse).toHaveBeenCalledOnce();
  });

  it("shows the selected workbook and enables processing", () => {
    const props = renderPage({
      ...emptyContext,
      selectedFile: { path: "C:/BOQ.xlsx", name: "BOQ.xlsx", size: 1024 },
    });

    expect(screen.getByText("BOQ.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start analysis/i }));
    expect(props.onStart).toHaveBeenCalledOnce();
  });
});
