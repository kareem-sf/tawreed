import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop, readInputFile } from '../../bridge';

export function currentDesktopWindow() {
  return isDesktop() ? getCurrentWindow() : null;
}

interface InputDropHandlers {
  onHover: (hovered: boolean) => void;
  onFile: (file: File) => void;
  onError: (reason: unknown) => void;
}

export async function listenForInputFileDrop({
  onHover,
  onFile,
  onError,
}: InputDropHandlers): Promise<() => void> {
  const appWindow = currentDesktopWindow();
  if (!appWindow) return () => undefined;

  return appWindow.onDragDropEvent(async (event) => {
    if (event.payload.type === 'over') {
      onHover(true);
      return;
    }
    if (event.payload.type !== 'drop') {
      onHover(false);
      return;
    }

    onHover(false);
    const path = event.payload.paths[0];
    if (!path) return;
    try {
      onFile(await readInputFile(path));
    } catch (reason) {
      onError(reason);
    }
  });
}
