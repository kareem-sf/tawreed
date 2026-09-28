import { useState } from "react";
import { useSettings } from "../app/settings";
import { button, textArea } from "../app/ui";

/** A one-off note for the AI when a step runs again. It's optional, and nothing answers it: the step just runs. */
export function NoteForm({
  onRun,
  onCancel,
  busy,
}: {
  onRun: (note: string | undefined) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useSettings();
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-2 animate-enter"
      onSubmit={(event) => {
        event.preventDefault();
        onRun(note.trim() || undefined);
      }}
    >
      <textarea
        aria-label={t("redo.note")}
        placeholder={t("redo.note")}
        value={note}
        rows={2}
        dir="auto"
        maxLength={4000}
        autoFocus
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
          // Ctrl+Enter (or ⌘+Enter) runs it, as in most note boxes.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit();
        }}
        className={textArea}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={button("primary", "sm")}>
          {t("redo.run")}
        </button>
        <button type="button" onClick={onCancel} className={button("quiet", "sm")}>
          {t("redo.cancel")}
        </button>
      </div>
    </form>
  );
}
