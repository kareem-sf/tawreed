import { useEffect, useMemo, useState } from 'react';
import { Clock3, Maximize2, Minus, Settings2, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { currentDesktopWindow } from '../platform/desktop/window';
import { appendAccessibleStatus } from '../lib/accessibility';
import Logo from './Logo';

interface Props {
  onSettings: () => void;
  onHistory: () => void;
  updateAvailable: boolean;
  modalOpen: boolean;
}

export default function TitleBar({ onSettings, onHistory, updateAvailable, modalOpen }: Props) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const appWindow = useMemo(() => currentDesktopWindow(), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || modalOpen) return;
      const action: Record<string, () => void> = {
        KeyH: onHistory,
        KeyS: onSettings,
        KeyM: () => { void appWindow?.minimize().catch(() => undefined); },
      };
      const run = action[event.code];
      if (run) {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [onHistory, onSettings, appWindow, modalOpen]);

  useEffect(() => {
    if (!appWindow) return undefined;
    let unlisten: (() => void) | undefined;
    const sync = () => void appWindow.isMaximized().then(setMaximized).catch(() => undefined);
    sync();
    void appWindow.onResized(sync).then((stop) => { unlisten = stop; });
    return () => unlisten?.();
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

  const settingsLabel = appendAccessibleStatus(
    t('settings'),
    updateAvailable ? t('updateAvailableIndicator') : undefined,
  );

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <Logo size={18} />
        <span className="font-serif-display text-[13px] font-semibold tracking-[-0.01em] text-ledger-ink">
          {t('appTitle')}
        </span>
      </div>

      <div className="flex h-full items-center gap-0.5">
        <button className="titlebar-nav" onClick={onHistory} aria-label={t('history')}>
          <Clock3 size={13} /> <span>{t('history')}</span>
        </button>
        <button className="titlebar-nav relative" onClick={onSettings} aria-label={settingsLabel}>
          <Settings2 size={13} /> <span>{t('settings')}</span>
          {updateAvailable && (
            <span
              aria-hidden="true"
              className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-gold"
            />
          )}
        </button>

        <div aria-hidden="true" className="mx-1.5 h-3.5 w-px bg-ledger-line" />

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
    </div>
  );
}
