import { useState } from 'react';
import { ActionIcon, Loader, Tooltip } from '@mantine/core';
import { AlertCircle, ArrowDownToLine, ArrowUpRight, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openUrl, type UpdateInfo } from '../bridge';
import Logo from './Logo';
import { AnimatedShinyText } from './ui/animated-shiny-text';
import { BlurFade } from './ui/blur-fade';
import { ShimmerButton } from './ui/shimmer-button';

export type UpdateState =
  | { status: 'idle' | 'checking' }
  | { status: 'available' | 'current'; info: UpdateInfo }
  | { status: 'error'; code: string };

interface Props {
  version: string;
  update: UpdateState;
  onCheckUpdate: () => Promise<void>;
  onOpenUpdate: (version: string) => Promise<void>;
  onClose: () => void;
}

export default function AboutModal({ version, update, onCheckUpdate, onOpenUpdate, onClose }: Props) {
  const { t } = useTranslation();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const capabilities = [
    [t('aboutFormats'), t('aboutFormatsDetail')],
    [t('aboutLanguages'), t('aboutLanguagesDetail')],
    [t('aboutDelivery'), t('aboutDeliveryDetail')],
  ];

  return (
    <div className="relative -m-4 overflow-hidden bg-[#fbfaf7] text-start dark:bg-[#0d0d10]">
      <div className="h-px bg-gradient-to-r from-transparent via-amber-500/80 to-transparent" />
      <Tooltip label={t('close')} openDelay={180}>
        <ActionIcon className="absolute end-3 top-3 z-20" variant="subtle" color="gray" size="sm" onClick={onClose} aria-label={t('close')}>
          <X size={14} />
        </ActionIcon>
      </Tooltip>

      <div className="px-7 pb-6 pt-6">
        <BlurFade className="flex items-center justify-between pe-8" delay={0.01}>
          <div className="flex items-center gap-2.5">
            <Logo size={27} />
            <div>
              <div className="text-[14px] font-bold tracking-[-0.03em] text-zinc-950 dark:text-white">TAWREED</div>
              <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-zinc-400">{t('aboutDesktopLabel')}</div>
            </div>
          </div>
          <span className="font-mono text-[9px] text-zinc-400">v{version}</span>
        </BlurFade>

        <BlurFade className="mt-7" delay={0.06}>
          <AnimatedShinyText className="text-[9px] font-bold uppercase tracking-[0.2em]">
            {t('aboutKicker')}
          </AnimatedShinyText>
          <h2 className="mt-2 max-w-[360px] text-[25px] font-semibold leading-[1.08] tracking-[-0.045em] text-zinc-950 dark:text-zinc-50">
            {t('aboutHeadline')}
          </h2>
          <p className="mt-3 max-w-[390px] text-[11px] leading-[1.65] text-zinc-600 dark:text-zinc-400">
            {t('aboutBody')}
          </p>
        </BlurFade>

        <BlurFade className="mt-5 border-s-2 border-amber-500 ps-3" delay={0.1}>
          <p className="text-[10px] font-medium leading-4 text-zinc-700 dark:text-zinc-300">{t('aboutPrinciple')}</p>
        </BlurFade>

        <BlurFade className="mt-6 grid grid-cols-3 border-y border-zinc-200/80 py-3.5 dark:border-white/10" delay={0.14}>
          {capabilities.map(([value, label], index) => (
            <div key={value} className={`min-w-0 px-3 first:ps-0 last:pe-0 ${index > 0 ? 'border-s border-zinc-200/80 dark:border-white/10' : ''}`}>
              <div className="truncate text-[10px] font-bold text-zinc-900 dark:text-zinc-100" title={value}>{value}</div>
              <div className="mt-0.5 text-[8px] uppercase tracking-[0.08em] text-zinc-400">{label}</div>
            </div>
          ))}
        </BlurFade>

        <BlurFade className="mt-4 flex min-h-10 items-center justify-between gap-4 rounded-lg bg-zinc-100/70 px-3 py-2.5 dark:bg-white/[0.045]" delay={0.16}>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-800 dark:text-zinc-200">
              {update.status === 'checking' && <Loader size={11} color="yellow" />}
              {update.status === 'current' && <CheckCircle2 size={12} className="text-emerald-500" />}
              {update.status === 'available' && <ArrowDownToLine size={12} className="text-amber-500" />}
              {update.status === 'error' && <AlertCircle size={12} className="text-red-500" />}
              <span>
                {update.status === 'checking' && t('checkingForUpdates')}
                {update.status === 'current' && t('upToDate')}
                {update.status === 'available' && t('updateAvailable', { version: update.info.latest_version })}
                {update.status === 'error' && t(
                  update.code === 'offline' ? 'updateOffline'
                    : update.code === 'rate_limited' ? 'updateRateLimited'
                      : update.code === 'service_unavailable' ? 'updateServiceUnavailable'
                        : update.code === 'no_stable_release' ? 'updateNoRelease'
                          : update.code === 'invalid_release' || update.code === 'missing_update_asset' ? 'updateReleaseInvalid'
                            : 'updateCheckFailed'
                )}
                {update.status === 'idle' && t('checkForUpdates')}
              </span>
            </div>
            {update.status === 'available' && <div className="mt-0.5 text-[8px] text-zinc-500">{t('updateReadyDetail')}</div>}
            {update.status === 'available' && update.info.asset_sha256 && (
              <div className="mt-0.5 break-all font-mono text-[7px] text-zinc-400">{t('updateChecksum', { hash: update.info.asset_sha256 })}</div>
            )}
            {downloadFailed && <div className="mt-0.5 text-[8px] text-red-500">{t('updateDownloadFailed')}</div>}
          </div>
          {update.status === 'available' ? (
            <button
              className="shrink-0 rounded-md bg-amber-500 px-2.5 py-1.5 text-[9px] font-bold text-zinc-950 transition hover:bg-amber-400"
              onClick={() => {
                setDownloadFailed(false);
                void onOpenUpdate(update.info.latest_version).catch(() => setDownloadFailed(true));
              }}
            >
              {t('openUpdateRelease')}
            </button>
          ) : (
            <button
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[9px] font-semibold text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-400"
              disabled={update.status === 'checking'}
              onClick={() => void onCheckUpdate()}
            >
              <RefreshCw size={10} /> {update.status === 'error' ? t('tryAgain') : t('checkForUpdates')}
            </button>
          )}
        </BlurFade>

        <BlurFade className="mt-3 flex items-center gap-3 text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-400" delay={0.17}>
          <button className="transition hover:text-amber-600" onClick={() => void openUrl('https://github.com/sfkareem/tawreed').catch(() => undefined)}>{t('viewRepo')}</button>
          <span aria-hidden="true">·</span>
          <button className="transition hover:text-amber-600" onClick={() => void openUrl('https://github.com/sfkareem/tawreed/blob/main/LICENSE').catch(() => undefined)}>{t('mitLicense')}</button>
        </BlurFade>

        <BlurFade className="mt-4 flex items-end justify-between gap-5" delay={0.18}>
          <div>
            <div className="text-[8px] font-bold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">{t('aboutCreatorLabel')}</div>
            <div className="mt-1 text-[13px] font-semibold text-zinc-950 dark:text-white">Kareem Safwat</div>
            <div className="mt-0.5 text-[9px] text-zinc-500">{t('aboutCreatorCredit')}</div>
          </div>
          <ShimmerButton
            className="shrink-0 px-3.5 py-2 text-[10px]"
            onClick={() => openUrl('https://kareemsafwat.com').catch(() => undefined)}
            title={t('openPortfolio')}
          >
            <span className="flex items-center gap-1.5">
              kareemsafwat.com <ArrowUpRight className="h-3 w-3" />
            </span>
          </ShimmerButton>
        </BlurFade>
      </div>
    </div>
  );
}
