import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { Clock, Info, Maximize2, Minus, Monitor, Moon, Settings2, Sun, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { isDesktop, setSetting } from '../bridge';
import Logo from './Logo';

interface Props {
  onSettings: () => void;
  onHistory: () => void;
  onAbout: () => void;
  updateAvailable: boolean;
  modalOpen: boolean;
}

function Hint({ label, shortcut, detail }: { label: string; shortcut?: string; detail?: string }) {
  return (
    <div className="max-w-52 py-0.5">
      <div className="flex items-center justify-between gap-5 text-[11px] font-semibold">
        <span>{label}</span>
        {shortcut && <kbd className="font-mono text-[9px] font-normal opacity-55">{shortcut}</kbd>}
      </div>
      {detail && <div className="mt-0.5 text-[9px] leading-3 opacity-65">{detail}</div>}
    </div>
  );
}

function Tip({ label, shortcut, detail, children }: { label: string; shortcut?: string; detail?: string; children: ReactNode }) {
  return <Tooltip label={<Hint label={label} shortcut={shortcut} detail={detail} />} openDelay={220}>{children}</Tooltip>;
}

export default function TitleBar({ onSettings, onHistory, onAbout, updateAvailable, modalOpen }: Props) {
  const { t, i18n } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  // Stable wrapper — getCurrentWindow() returns a new object each call, which would re-run effects every render.
  const appWindow = useMemo(() => (isDesktop() ? getCurrentWindow() : null), []);

  const cycleTheme = useCallback(() => {
    setColorScheme(colorScheme === 'auto' ? 'light' : colorScheme === 'light' ? 'dark' : 'auto');
  }, [colorScheme, setColorScheme]);
  const switchLanguage = useCallback(() => {
    const newLang = i18n.language === 'ar' ? 'en' : 'ar';
    void i18n.changeLanguage(newLang);
    void setSetting('language', newLang).catch(() => undefined);
  }, [i18n]);
  const ThemeIcon = colorScheme === 'light' ? Sun : colorScheme === 'dark' ? Moon : Monitor;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || modalOpen) return;
      // Match physical keys (event.code) so shortcuts work on Arabic keyboard layouts too.
      const action: Record<string, () => void> = {
        KeyT: cycleTheme,
        KeyL: switchLanguage,
        KeyH: onHistory,
        KeyA: onAbout,
        KeyS: onSettings,
        KeyM: () => { void appWindow?.minimize(); },
      };
      const run = action[event.code];
      if (run) {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [cycleTheme, switchLanguage, onHistory, onAbout, onSettings, appWindow, modalOpen]);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <Tip label={t('appTitle')} detail={t('brandDetail')}>
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <Logo size={19} />
          <span className="text-[13px] font-semibold tracking-[-0.02em]">{t('appTitle')}</span>
        </div>
      </Tip>

      <div className="flex items-center gap-0.5">
        <Tip label={t('theme')} shortcut="Alt+T" detail={t('themeDetail')}>
          <ActionIcon variant="subtle" size="sm" color="gray" onClick={cycleTheme} aria-label={t('theme')}>
            <ThemeIcon size={14} />
          </ActionIcon>
        </Tip>
        <Tip label={t('language')} shortcut="Alt+L" detail={t('languageDetail')}>
          <ActionIcon variant="subtle" size="sm" color="gray" onClick={switchLanguage} aria-label={t('language')}>
            <span className="text-[10px] font-bold">{i18n.language === 'ar' ? 'EN' : 'ع'}</span>
          </ActionIcon>
        </Tip>
        <Tip label={t('history')} shortcut="Alt+H" detail={t('historyDetail')}>
          <ActionIcon variant="subtle" size="sm" color="gray" onClick={onHistory} aria-label={t('history')}>
            <Clock size={14} />
          </ActionIcon>
        </Tip>
        <Tip label={updateAvailable ? t('updateAvailableIndicator') : t('about')} shortcut="Alt+A" detail={t('aboutDetail')}>
          <ActionIcon className="relative" variant="subtle" size="sm" color="gray" onClick={onAbout} aria-label={updateAvailable ? t('updateAvailableIndicator') : t('about')}>
            <Info size={14} />
            {updateAvailable && <span className="absolute end-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-white dark:ring-zinc-900" />}
          </ActionIcon>
        </Tip>
        <Tip label={t('settings')} shortcut="Alt+S" detail={t('settingsDetail')}>
          <ActionIcon variant="subtle" size="sm" color="gray" onClick={onSettings} aria-label={t('settings')}>
            <Settings2 size={14} />
          </ActionIcon>
        </Tip>

        <div className="mx-1.5 h-3.5 w-px bg-gray-400/30" />

        <Tip label={t('minimize')} shortcut="Alt+M">
          <button className="titlebar-btn" onClick={() => appWindow?.minimize()} aria-label={t('minimize')}>
            <Minus size={14} />
          </button>
        </Tip>
        <Tip label={t('maximize')}>
          <button
            className="titlebar-btn"
            onClick={() => appWindow?.toggleMaximize()}
            aria-label={t('maximize')}
          >
            <Maximize2 size={12} />
          </button>
        </Tip>
        <Tip label={t('close')} shortcut="Alt+F4">
          <button className="titlebar-btn close" onClick={() => appWindow?.close()} aria-label={t('close')}>
            <X size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
