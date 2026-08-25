import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, RotateCcw, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RuntimeBootstrapStatus } from '../../../shared/platform';
import Logo from '../../components/Logo';
import { currentDesktopWindow } from '../../platform/desktop/window';
import { createMaximizeMonitor } from './titleBarLifecycle';
import { isPublicRuntimeErrorCode, runtimeTechnicalDetails } from './types';

interface BootstrapScreenProps {
  status: RuntimeBootstrapStatus;
  onRetry: () => void;
}

function BootstrapTitleBar() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const appWindow = useMemo(() => currentDesktopWindow(), []);

  useEffect(() => {
    if (!appWindow) return undefined;
    const monitor = createMaximizeMonitor({
      read: () => appWindow.isMaximized(),
      subscribe: (handler) => appWindow.onResized(handler),
    }, setMaximized);
    monitor.start();
    return monitor.dispose;
  }, [appWindow]);

  const runWindowAction = (action: 'minimize' | 'maximize' | 'close') => {
    if (!appWindow) return;
    const task = action === 'minimize'
      ? appWindow.minimize()
      : action === 'maximize'
        ? appWindow.toggleMaximize()
        : appWindow.close();
    void task.catch(() => undefined);
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <Logo size={18} />
        <span className="text-[13px] font-semibold tracking-[-0.02em]">{t('appTitle')}</span>
      </div>
      <div className="flex h-full items-center gap-0.5">
        <button className="titlebar-btn" onClick={() => runWindowAction('minimize')} aria-label={t('minimize')}>
          <Minus size={14} />
        </button>
        <button className="titlebar-btn" onClick={() => runWindowAction('maximize')} aria-label={t('maximize')}>
          {maximized ? <Square size={11} /> : <Maximize2 size={12} />}
        </button>
        <button className="titlebar-btn close" onClick={() => runWindowAction('close')} aria-label={t('close')}>
          <X size={14} />
        </button>
      </div>
    </header>
  );
}

export function BootstrapScreen({ status, onRetry }: BootstrapScreenProps) {
  const { t } = useTranslation();
  const retryRef = useRef<HTMLButtonElement>(null);
  const showRetry = status.phase === 'error' && status.recoverable;
  const details = runtimeTechnicalDetails(status);
  const errorKey = isPublicRuntimeErrorCode(status.errorCode)
    ? `runtimeError.${status.errorCode}`
    : 'runtimeError.unknown';

  useEffect(() => {
    if (showRetry) retryRef.current?.focus();
  }, [showRetry]);

  return (
    <div className="app-frame text-zinc-950 dark:text-white">
      <BootstrapTitleBar />
      <main
        className="flex min-h-0 flex-1 items-center justify-center px-8 pb-12"
        aria-busy={status.phase !== 'ready'}
      >
        <section className="w-full max-w-md text-center">
          <Logo size={46} className="mx-auto drop-shadow-[0_8px_22px_rgba(232,181,74,0.22)]" />
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.035em]">
            {t('preparingTawreed')}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {t('runtimeSetupDetail')}
          </p>

          <div className="mx-auto mt-8 w-full max-w-sm">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
              role="progressbar"
              aria-label={t('setupProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status.progress ?? undefined}
            >
              <div
                className={status.progress === null
                  ? 'bootstrap-progress-indeterminate h-full rounded-full bg-amber-500'
                  : 'h-full rounded-full bg-amber-500 transition-[width] duration-300 motion-reduce:transition-none'}
                style={status.progress === null ? undefined : { width: `${status.progress}%` }}
              />
            </div>
            {status.progress !== null ? (
              <div className="mt-2 text-[11px] tabular-nums text-zinc-500">
                {Math.round(status.progress)}%
              </div>
            ) : null}
          </div>

          <div className="mt-5" role="status" aria-live="polite" aria-atomic="true">
            <p className="text-sm font-medium">{t(`runtimePhase.${status.phase}`)}</p>
            {status.phase === 'error' ? (
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                {t(errorKey)}
              </p>
            ) : null}
          </div>

          {showRetry ? (
            <button
              ref={retryRef}
              type="button"
              className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 motion-reduce:transition-none"
              onClick={onRetry}
            >
              <RotateCcw size={14} aria-hidden="true" />
              {t('retry')}
            </button>
          ) : null}

          {details.length > 0 ? (
            <details className="mx-auto mt-6 max-w-sm text-start text-xs text-zinc-500 dark:text-zinc-400">
              <summary className="cursor-pointer rounded-md py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
                {t('technicalDetails')}
              </summary>
              <code className="allow-select mt-2 block break-all rounded-lg bg-zinc-100 px-3 py-2 leading-5 dark:bg-white/[0.05]">
                {details.join(' · ')}
              </code>
            </details>
          ) : null}
        </section>
      </main>
    </div>
  );
}
