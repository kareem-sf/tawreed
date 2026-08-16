import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  codexInstall,
  codexLogin,
  codexModels,
  codexStatus,
  deleteApiKey,
  deleteCompatibleApiKey,
  getSettings,
  setApiKey,
  setCompatibleApiKey,
  setSetting,
  testCompatibleProvider,
  type CodexStatus,
  type ModelInfo,
} from '../../bridge';
import type { CompatibleSettings, Provider, ProviderMessage } from './provider-types';

interface Options {
  onConfigured?: (provider: Provider | 'offline') => void;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function delay(duration: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

export function useProviderSetup({ onConfigured }: Options = {}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<Provider>('codex');
  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [compatibleKey, setCompatibleKey] = useState('');
  const [compatible, setCompatible] = useState<CompatibleSettings>({ baseUrl: '', model: '' });
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState<ProviderMessage | null>(null);

  const refreshCodex = useCallback(async () => {
    try {
      const status = await codexStatus();
      setCodex(status);
      return status;
    } catch {
      setCodex(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshCodex();
    void getSettings().then((settings) => {
      const current = settings.activeProvider;
      if (current === 'codex' || current === 'anthropic' || current === 'compatible') {
        setProvider(current);
      }
      if (typeof settings.model === 'string' && settings.model) setModel(settings.model);
      const next = settings.compatible;
      if (next && typeof next === 'object') {
        const object = next as Record<string, unknown>;
        setCompatible({
          baseUrl: typeof object.baseUrl === 'string' ? object.baseUrl : '',
          model: typeof object.model === 'string' ? object.model : '',
        });
      }
    });
  }, [refreshCodex]);

  useEffect(() => {
    if (!codex?.authenticated) {
      setModels([]);
      return;
    }
    void codexModels().then(setModels).catch(() => setModels([]));
  }, [codex?.authenticated]);

  const selectProvider = useCallback(async (next: Provider) => {
    setProvider(next);
    await setSetting('activeProvider', next);
  }, []);

  const installCodex = useCallback(async () => {
    setWorking('codex-install');
    setMessage(null);
    try {
      await codexInstall();
      await refreshCodex();
    } catch (reason) {
      setMessage({ color: 'red', text: errorMessage(reason) });
    } finally {
      setWorking('');
    }
  }, [refreshCodex]);

  const loginCodex = useCallback(async () => {
    setWorking('codex-login');
    setMessage(null);
    try {
      await codexLogin();
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await delay(2_000);
        const status = await refreshCodex();
        if (status?.authenticated) break;
      }
    } catch (reason) {
      setMessage({ color: 'red', text: errorMessage(reason) });
    } finally {
      setWorking('');
    }
  }, [refreshCodex]);

  const chooseModel = useCallback((value: string | null) => {
    setModel(value);
    void setSetting('model', value ?? '');
  }, []);

  const saveAnthropic = useCallback(async () => {
    setWorking('anthropic');
    setMessage(null);
    try {
      await setApiKey(anthropicKey);
      await setSetting('activeProvider', 'anthropic');
      setProvider('anthropic');
      setAnthropicKey('');
      setMessage({ color: 'green', text: t('connectionSaved') });
      onConfigured?.('anthropic');
    } catch (reason) {
      setMessage({ color: 'red', text: errorMessage(reason) });
    } finally {
      setWorking('');
    }
  }, [anthropicKey, onConfigured, t]);

  const removeAnthropic = useCallback(async () => {
    await deleteApiKey();
    setMessage({ color: 'green', text: t('keyRemoved') });
  }, [t]);

  const saveCompatible = useCallback(async () => {
    setWorking('compatible');
    setMessage(null);
    try {
      await setSetting('compatible', compatible);
      if (compatibleKey.trim()) await setCompatibleApiKey(compatibleKey);
      await setSetting('activeProvider', 'compatible');
      setProvider('compatible');
      const connected = await testCompatibleProvider();
      setCompatibleKey('');
      setMessage({
        color: connected ? 'green' : 'yellow',
        text: connected ? t('connectionTestPassed') : t('connectionSaved'),
      });
      onConfigured?.('compatible');
    } catch (reason) {
      setMessage({ color: 'red', text: errorMessage(reason) });
    } finally {
      setWorking('');
    }
  }, [compatible, compatibleKey, onConfigured, t]);

  const removeCompatible = useCallback(async () => {
    await deleteCompatibleApiKey();
    setMessage({ color: 'green', text: t('keyRemoved') });
  }, [t]);

  return {
    provider,
    codex,
    models,
    model,
    anthropicKey,
    compatibleKey,
    compatible,
    working,
    message,
    setAnthropicKey,
    setCompatibleKey,
    setCompatible,
    selectProvider,
    refreshCodex,
    installCodex,
    loginCodex,
    chooseModel,
    saveAnthropic,
    removeAnthropic,
    saveCompatible,
    removeCompatible,
  };
}
