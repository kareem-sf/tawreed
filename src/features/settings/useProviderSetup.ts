import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  codexInstall,
  codexLogin,
  codexModels,
  codexStatus,
  deleteApiKey,
  deleteCompatibleApiKey,
  deleteGeminiApiKey,
  deleteGrokApiKey,
  geminiModels,
  getSettings,
  grokModels,
  setApiKey,
  setCompatibleApiKey,
  setGeminiApiKey,
  setGrokApiKey,
  setSetting,
  testAnthropicProvider,
  testCompatibleProvider,
  testGeminiProvider,
  testGrokProvider,
  type CodexStatus,
  type ModelInfo,
} from '../../bridge';
import { useNamedProviderSetup } from './useNamedProviderSetup';
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

/** A saved key is only reported green once a live probe confirms it actually works. */
const saveResult = (connected: boolean, t: (key: string) => string): ProviderMessage => ({
  color: connected ? 'green' : 'yellow',
  text: connected ? t('connectionTestPassed') : t('connectionSaved'),
});

/** Drops Google's `models/` prefix so a previously saved model still matches the list. */
function readSettingModel(settings: Record<string, unknown>, key: string): string | null {
  const scoped = settings[key];
  if (!scoped || typeof scoped !== 'object') return null;
  const value = (scoped as Record<string, unknown>).model;
  return typeof value === 'string' && value ? value.replace(/^models\//, '') : null;
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

  const gemini = useNamedProviderSetup(
    'gemini',
    { setKey: setGeminiApiKey, deleteKey: deleteGeminiApiKey, test: testGeminiProvider, models: geminiModels },
    t('connectionSaved'), t('connectionTestPassed'), t('keyRemoved'),
    setProvider, setWorking, setMessage, onConfigured,
  );
  const grok = useNamedProviderSetup(
    'grok',
    { setKey: setGrokApiKey, deleteKey: deleteGrokApiKey, test: testGrokProvider, models: grokModels },
    t('connectionSaved'), t('connectionTestPassed'), t('keyRemoved'),
    setProvider, setWorking, setMessage, onConfigured,
  );

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
    // Async bootstrap: every write below lands in a promise continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCodex();
    void getSettings().then((settings) => {
      const current = settings.activeProvider;
      if (
        current === 'codex' || current === 'anthropic' || current === 'compatible'
        || current === 'gemini' || current === 'grok'
      ) {
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
      const geminiSaved = readSettingModel(settings, 'gemini');
      if (geminiSaved) gemini.setModel(geminiSaved);
      const grokSaved = readSettingModel(settings, 'grok');
      if (grokSaved) grok.setModel(grokSaved);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCodex]);

  useEffect(() => {
    if (!codex?.authenticated) {
      // Clearing a derived list when sign-in drops; guarded, so it settles at once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      const connected = await testAnthropicProvider();
      setAnthropicKey('');
      setMessage(saveResult(connected, t));
      onConfigured?.('anthropic');
    } catch (reason) {
      setMessage({ color: 'red', text: errorMessage(reason) });
    } finally {
      setWorking('');
    }
  }, [anthropicKey, onConfigured, t]);

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
      setMessage(saveResult(connected, t));
      onConfigured?.('compatible');
    } catch (reason) {
      setMessage({ color: 'red', text: errorMessage(reason) });
    } finally {
      setWorking('');
    }
  }, [compatible, compatibleKey, onConfigured, t]);

  const removeKey = useCallback(async (deleteKey: () => Promise<unknown>) => {
    await deleteKey();
    setMessage({ color: 'green', text: t('keyRemoved') });
    onConfigured?.('offline');
  }, [onConfigured, t]);
  const removeAnthropic = useCallback(() => removeKey(deleteApiKey), [removeKey]);
  const removeCompatible = useCallback(() => removeKey(deleteCompatibleApiKey), [removeKey]);

  return {
    provider,
    codex,
    models,
    model,
    anthropicKey,
    compatibleKey,
    compatible,
    geminiKey: gemini.key,
    geminiModel: gemini.model,
    geminiModelList: gemini.modelList,
    grokKey: grok.key,
    grokModel: grok.model,
    grokModelList: grok.modelList,
    working,
    message,
    setAnthropicKey,
    setCompatibleKey,
    setCompatible,
    setGeminiKey: gemini.setKey,
    setGrokKey: grok.setKey,
    selectProvider,
    refreshCodex,
    installCodex,
    loginCodex,
    chooseModel,
    saveAnthropic,
    removeAnthropic,
    saveCompatible,
    removeCompatible,
    chooseGeminiModel: gemini.chooseModel,
    saveGemini: gemini.save,
    removeGemini: gemini.remove,
    chooseGrokModel: grok.chooseModel,
    saveGrok: grok.save,
    removeGrok: grok.remove,
  };
}
