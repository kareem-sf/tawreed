import { isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import type { SelectedWorkbook } from "./engine/types";

export async function chooseWorkbook(): Promise<SelectedWorkbook | null> {
  if (isTauri()) {
    const path = await open({
      title: "Select a BOQ workbook",
      multiple: false,
      directory: false,
      filters: [{ name: "Excel workbooks", extensions: ["xlsx"] }],
      fileAccessMode: "scoped",
    });
    return typeof path === "string" ? workbookFromPath(path) : null;
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(
        file ? { path: file.name, name: file.name, size: file.size } : null,
      );
    };
    input.click();
  });
}

export function workbookFromPath(
  path: string,
  size?: number,
): SelectedWorkbook {
  const segments = path.split(/[\\/]/);
  return { path, name: segments[segments.length - 1] || path, size };
}

export async function registerNativeWorkbookDrop(
  onWorkbook: (file: SelectedWorkbook) => void,
): Promise<UnlistenFn | null> {
  if (!isTauri()) {
    return null;
  }
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") {
      return;
    }
    const path = event.payload.paths.find((candidate) =>
      candidate.toLowerCase().endsWith(".xlsx"),
    );
    if (path) {
      onWorkbook(workbookFromPath(path));
    }
  });
}

export async function openOutput(path: string): Promise<void> {
  if (isTauri()) {
    await openPath(path);
  }
}

export async function revealOutput(path: string): Promise<void> {
  if (isTauri()) {
    await revealItemInDir(path);
  }
}
