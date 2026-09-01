import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { listenForInputFileDrop } from '../../../platform/desktop/window';
import Logo from '../../../components/Logo';

export default function FileUpload({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const rejectTimer = useRef<number | null>(null);
  const onFileRef = useRef(onFile);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

  const reject = useCallback((message: string) => {
    setError(message);
    if (rejectTimer.current !== null) window.clearTimeout(rejectTimer.current);
    rejectTimer.current = window.setTimeout(() => { setError(null); rejectTimer.current = null; }, 3500);
  }, []);

  const accept = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv|ods|pdf)$/i.test(file.name)) {
      reject(t('inputOnly'));
      return;
    }
    onFileRef.current(file);
  }, [reject, t]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForInputFileDrop({
      onHover: setDragging,
      onFile: accept,
      onError: (reason) => reject(reason instanceof Error ? reason.message : String(reason)),
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (rejectTimer.current !== null) window.clearTimeout(rejectTimer.current);
    };
  }, [accept, reject]);

  const onBrowserDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files?.[0]);
  };

  return (
    <div
      className="relative mx-auto flex h-[300px] w-full max-w-lg flex-col items-center justify-center px-8 text-center"
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => {
        // dragleave also fires when the pointer moves onto a child — only clear when truly leaving the container.
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      }}
      onDrop={onBrowserDrop}
    >
      <motion.div
        animate={{ y: dragging ? -5 : 0, scale: dragging ? 1.08 : 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        className="relative mb-5"
      >
        <Logo size={68} className="relative drop-shadow-[0_10px_28px_rgba(232,181,74,0.24)]" />
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={dragging ? 'dragging' : 'idle'}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          className="space-y-1.5"
        >
          <h1 className="font-serif-display text-[20px] font-semibold tracking-[-0.01em] text-ledger-ink">
            {dragging ? t('releaseWorkbook') : t('selectTitle')}
          </h1>
          <p className="mx-auto max-w-sm text-[11px] leading-5 text-ledger-ink-faint">
            {t('selectHint')}
          </p>
        </motion.div>
      </AnimatePresence>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-5 flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-semibold text-[#1c1408] shadow-lg transition-transform hover:-translate-y-0.5 active:translate-y-0"
        style={{
          background: 'linear-gradient(180deg, #f3c968, var(--gold))',
          boxShadow: '0 8px 20px -6px rgba(232,181,74,0.5)',
        }}
        title={t('browseDetail')}
      >
        <FileSpreadsheet className="h-4 w-4" />
        <span>{t('browse')}</span>
        <UploadCloud className="h-3.5 w-3.5 opacity-50" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.ods,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/vnd.oasis.opendocument.spreadsheet"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          accept(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute bottom-0 text-xs font-medium text-red-500 dark:text-red-400"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
