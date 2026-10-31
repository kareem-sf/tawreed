import { useRef, useState, type DragEvent, type ReactNode } from "react";

// What the file picker offers; the service decides what it accepts.
export const ACCEPT = ".xlsx,.xlsm,.xls,.ods,.csv,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp";

// Dragging a picture inside Tawreed (a page preview, say) makes the browser offer it as a file too.
// Only drags that come from outside the window are files the engineer is adding.
let dragFromPage = false;
window.addEventListener("dragstart", () => (dragFromPage = true));
for (const done of ["dragend", "drop"]) window.addEventListener(done, () => (dragFromPage = false)); // drop: in case the dragged element is gone

const hasFiles = (event: Pick<globalThis.DragEvent, "dataTransfer">) =>
  !dragFromPage && Array.from(event.dataTransfer?.types ?? []).includes("Files");

// Files dropped anywhere that takes none must not be opened by the window (it would leave Tawreed for the file).
// The regions below handle their drops first; whatever reaches the window is refused.
window.addEventListener("dragover", (event) => {
  if (!hasFiles(event) || event.defaultPrevented) return; // a region that takes the files has already said so
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
});
window.addEventListener("drop", (event) => {
  if (hasFiles(event)) event.preventDefault();
});

/** A region that takes dropped files. `over` is true while files are dragged above it. A disabled one takes none
 *  (a drop meanwhile is refused, not queued). */
export function DropRegion({
  onFiles,
  className,
  disabled = false,
  children,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  disabled?: boolean;
  children: (over: boolean) => ReactNode;
}) {
  const [depth, setDepth] = useState(0); // dragenter/leave fire for every child, so count them
  const carriesFiles = (event: DragEvent) => !disabled && hasFiles(event);

  return (
    <div
      className={className}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDepth((d) => d + 1);
      }}
      onDragOver={(event) => {
        if (carriesFiles(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (carriesFiles(event)) setDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDepth(0);
        if (!carriesFiles(event)) return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children(depth > 0)}
    </div>
  );
}

/** A button that opens the system file picker. */
export function PickFiles({
  onFiles,
  className,
  disabled,
  label,
  children,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  disabled?: boolean;
  label?: string; // the button's name when its text can be hidden (a narrow window)
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={label}
        title={label}
        onClick={() => input.current?.click()}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        data-testid="file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ""; // choosing the same file again should still fire
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}
