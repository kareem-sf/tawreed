import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { isDesktop, readInputFile } from '../bridge';
import Logo from './Logo';

export default function FileUpload({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const rejectTimer = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reject = (message: string) => {
    setError(message);
    if (rejectTimer.current !== null) window.clearTimeout(rejectTimer.current);
    rejectTimer.current = window.setTimeout(() => { setError(null); rejectTimer.current = null; }, 3500);
  };

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|pdf)$/i.test(file.name)) {
      reject(t('inputOnly'));
      return;
    }
    onFile(file);
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isDesktop()) {
      getCurrentWindow().onDragDropEvent(async (event) => {
        if (event.payload.type === 'over') {
          setDragging(true);
          return;
        }
        if (event.payload.type === 'drop') {
          setDragging(false);
          const path = event.payload.paths[0];
          if (!path) return;
          try {
            accept(await readInputFile(path));
          } catch (err) {
            reject(err instanceof Error ? err.message : String(err));
          }
          return;
        }
        setDragging(false);
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    }
    return () => {
      disposed = true;
      unlisten?.();
      if (rejectTimer.current !== null) window.clearTimeout(rejectTimer.current);
    };
  }, [onFile, t]);

  const onBrowserDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files?.[0]);
  };

  return (
    <div
      className="relative mx-auto flex h-[300px] w-full max-w-lg flex-col items-center justify-center px-8 text-center"
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
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
          <h1 className="text-[20px] font-semibold tracking-[-0.025em] text-zinc-900 dark:text-zinc-50">
            {dragging ? t('releaseWorkbook') : t('selectTitle')}
          </h1>
          <p className="mx-auto max-w-sm text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
            {t('selectHint')}
          </p>
        </motion.div>
      </AnimatePresence>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-5 flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-[12px] font-semibold text-white shadow-lg shadow-black/10 transition-transform hover:-translate-y-0.5 hover:bg-zinc-800 active:translate-y-0 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
        title={t('browseDetail')}
      >
        <FileSpreadsheet className="h-4 w-4" />
        <span>{t('browse')}</span>
        <UploadCloud className="h-3.5 w-3.5 opacity-50" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
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
