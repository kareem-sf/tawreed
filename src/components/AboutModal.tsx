import { useState } from 'react';
import { ActionIcon, Button, Loader } from '@mantine/core';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openUrl, type UpdateInfo } from '../bridge';
import Logo from './Logo';

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

export default function AboutModal({
  version,
  update,
  onCheckUpdate,
  onOpenUpdate,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const updateMessage = update.status === 'checking'
    ? t('checkingForUpdates')
    : update.status === 'current'
      ? t('upToDate')
      : update.status === 'available'
        ? t('updateAvailable', { version: update.info.latest_version })
        : update.status === 'error'
          ? t(
            update.code === 'offline' ? 'updateOffline'
              : update.code === 'rate_limited' ? 'updateRateLimited'
                : update.code === 'service_unavailable' ? 'updateServiceUnavailable'
                  : update.code === 'no_stable_release' ? 'updateNoRelease'
                    : update.code === 'invalid_release' || update.code === 'missing_update_asset'
                      ? 'updateReleaseInvalid'
                      : 'updateCheckFailed',
          )
          : t('checkForUpdates');

  return (
    <div className="-m-4 bg-white p-7 text-start dark:bg-zinc-950">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Logo size={30} />
          <div>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-white">Tawreed</h2>
            <p className="text-xs text-zinc-500">v{version}</p>
          </div>
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label={t('close')}>
          <X size={15} />
        </ActionIcon>
      </div>

      <p className="mt-6 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {t('aboutHeadline')}
      </p>
      <p className="mt-2 max-w-lg text-xs leading-5 text-zinc-600 dark:text-zinc-400">
        {t('aboutBody')}
      </p>
      <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:bg-white/[0.04] dark:text-zinc-300">
        {t('aboutPrinciple')}
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          [t('aboutFormats'), t('aboutFormatsDetail')],
          [t('aboutLanguages'), t('aboutLanguagesDetail')],
          [t('aboutDelivery'), t('aboutDeliveryDetail')],
        ].map(([value, label]) => (
          <div key={value} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
            <div className="mt-1 text-[10px] text-zinc-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-3 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          {update.status === 'checking' && <Loader size={13} color="yellow" />}
          {update.status === 'current' && <CheckCircle2 size={14} className="text-emerald-600" />}
          {update.status === 'available' && <Download size={14} className="text-amber-600" />}
          {update.status === 'error' && <AlertCircle size={14} className="text-red-600" />}
          <span>{updateMessage}</span>
        </div>
        {update.status === 'available' ? (
          <Button
            size="compact-xs"
            color="yellow"
            onClick={() => {
              setDownloadFailed(false);
              void onOpenUpdate(update.info.latest_version).catch(() => setDownloadFailed(true));
            }}
          >
            {t('openUpdateRelease')}
          </Button>
        ) : (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            leftSection={<RefreshCw size={11} />}
            disabled={update.status === 'checking'}
            onClick={() => void onCheckUpdate()}
          >
            {update.status === 'error' ? t('tryAgain') : t('checkForUpdates')}
          </Button>
        )}
      </div>
      {downloadFailed && <p className="mt-1 text-xs text-red-600">{t('updateDownloadFailed')}</p>}

      <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-white/10">
        <p className="text-sm font-semibold text-zinc-950 dark:text-white">
          Developed by Kareem Safwat
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
          <button
            className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-amber-700 hover:underline dark:text-amber-400"
            onClick={() => void openUrl('https://kareemsafwat.com').catch(() => undefined)}
          >
            kareemsafwat.com <ArrowUpRight size={12} />
          </button>
          <button
            className="cursor-pointer border-0 bg-transparent p-0 text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            onClick={() => void openUrl('https://github.com/kareem-sf/tawreed').catch(() => undefined)}
          >
            {t('viewRepo')}
          </button>
          <button
            className="cursor-pointer border-0 bg-transparent p-0 text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            onClick={() => void openUrl('https://github.com/kareem-sf/tawreed/blob/main/LICENSE').catch(() => undefined)}
          >
            {t('mitLicense')}
          </button>
        </div>
      </div>
    </div>
  );
}
