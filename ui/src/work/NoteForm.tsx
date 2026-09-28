import { useState } from "react";
import { useSettings } from "../app/settings";

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
      className="flex flex-col gap-2"
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
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        className="rounded-lg border border-line bg-page px-3 py-2 focus:border-ink focus:outline-none"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-button px-3.5 py-1.5 text-button-ink disabled:opacity-50">
          {t("redo.run")}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3.5 py-1.5 hover:border-ink">
          {t("redo.cancel")}
        </button>
      </div>
    </form>
  );
}
