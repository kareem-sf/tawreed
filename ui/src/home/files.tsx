import { useRef, useState, type DragEvent, type ReactNode } from "react";

// What the file picker offers; the service decides what it accepts.
export const ACCEPT = ".xlsx,.xlsm,.xls,.ods,.csv,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp";

/** A region that takes dropped files. `over` is true while files are dragged above it. */
export function DropRegion({
  onFiles,
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  children: (over: boolean) => ReactNode;
}) {
  const [depth, setDepth] = useState(0); // dragenter/leave fire for every child, so count them
  const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

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
  children,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => input.current?.click()}>
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
