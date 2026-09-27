import { Loader2, Lock, PlugZap, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnections } from './useConnections';

interface ConnectionsCenterProps {
  onReadyChange?: (ready: boolean) => void;
}

function StatusBadge({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        ready
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
          : 'bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${ready ? 'bg-emerald-500' : 'bg-zinc-400'}`}
      />
      {label}
    </span>
  );
}

export function ConnectionsCenter({ onReadyChange }: ConnectionsCenterProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const connections = useConnections({ onReadyChange });
  const { state } = connections;
  const codex = state.summaries.find((summary) => summary.provider === 'codex');
  const busy = state.working !== null;
  const configured = codex?.configured ?? false;

  return (
    <section
      aria-label={t('connection')}
      className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em]">{t('codexTitle')}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {t('codexCardDetail')}
          </p>
        </div>
        <StatusBadge ready={connections.healthy} label={t(connections.healthy ? 'connectionReady' : 'signInRequired')} />
      </div>

      {state.lastError ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {t('connectionActionFailed')}
        </p>
      ) : null}

      {!state.mode ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-start transition hover:border-amber-500 hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-amber-500/10"
            onClick={() => connections.selectMode('chatgpt')}
          >
            <PlugZap size={18} className="shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              <span className="block text-sm font-semibold">{t('connectWithChatgpt')}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{t('chatGptConnectionDetail')}</span>
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-start transition hover:border-amber-500 hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-amber-500/10"
            onClick={() => connections.selectMode('api-key')}
          >
            <Lock size={18} className="shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              <span className="block text-sm font-semibold">{t('useApiKey')}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{t('apiKeyLoginDetail')}</span>
            </span>
          </button>
        </div>
      ) : null}

      {state.mode === 'chatgpt' ? (
        <div className="mt-5 rounded-xl bg-zinc-50 p-4 dark:bg-white/[0.04]">
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            {t('chatgptLoginDetail')}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              onClick={() => void connections.loginWithChatgpt()}
            >
              {state.working === 'chatgpt-login' ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {t(state.working === 'chatgpt-login' ? 'connecting' : 'connectWithChatgpt')}
            </button>
            <button
              type="button"
              disabled={busy}
              className="h-9 rounded-lg px-3 text-sm text-zinc-500 transition hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
              onClick={() => connections.selectMode(null)}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {state.mode === 'api-key' ? (
        <form
          className="mt-5 rounded-xl bg-zinc-50 p-4 dark:bg-white/[0.04]"
          onSubmit={(event) => {
            event.preventDefault();
            if (connections.canSave) void connections.saveCodexKey();
          }}
        >
          <label htmlFor="codex-api-key" className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {t('apiKeyLabel')}
          </label>
          <input
            id="codex-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            value={state.apiKey}
            onChange={(event) => connections.setApiKey(event.currentTarget.value)}
            disabled={busy}
            className="mt-2 block h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-amber-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-950"
          />
          <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={state.plaintextAcknowledged}
              onChange={(event) => {
                if (event.currentTarget.checked) connections.acknowledgePlaintext();
              }}
              className="mt-0.5 size-4 accent-amber-500"
            />
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <span>{t('plaintextCredentialWarning')}</span>
          </label>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={!connections.canSave}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {state.working === 'api-key-save' ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {t(state.working === 'api-key-save' ? 'connecting' : 'connect')}
            </button>
            <button
              type="button"
              disabled={busy}
              className="h-9 rounded-lg px-3 text-sm text-zinc-500 transition hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
              onClick={() => connections.selectMode(null)}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {configured ? (
        <div className="mt-5 flex items-center gap-2 border-t border-zinc-100 pt-4 dark:border-white/5">
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-amber-500 disabled:opacity-50 dark:border-white/10 dark:text-zinc-200"
            onClick={() => void connections.checkHealth()}
          >
            {state.working === 'health-check' ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {t('testConnection')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-8 rounded-lg px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
            onClick={() => void connections.removeCodexConnection()}
          >
            {t('removeConnection')}
          </button>
        </div>
      ) : null}

      <details
        className="mt-4 text-xs text-zinc-500 dark:text-zinc-400"
        open={showAdvanced}
        onToggle={(event) => setShowAdvanced(event.currentTarget.open)}
      >
        <summary className="cursor-pointer rounded-md py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
          {t('advancedDetails')}
        </summary>
        <p className="mt-2 leading-5">{t('providerModelsNote')}</p>
      </details>
    </section>
  );
}
