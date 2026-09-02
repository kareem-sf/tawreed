import { useCallback, useState } from 'react';
import { setSetting } from '../../bridge';
import type { Provider, ProviderMessage } from './provider-types';

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

interface Bridge {
  setKey: (key: string) => Promise<void>;
  deleteKey: () => Promise<void>;
  test: () => Promise<boolean>;
  models: () => Promise<string[]>;
}

/** Shared BYOK save/remove/model-select flow for a named provider (Gemini, Grok, …)
 * whose key management and model catalog both come straight from the provider's own
 * official API — no protocol logic here, just the UI-facing state machine. */
export function useNamedProviderSetup(
  id: Provider,
  bridge: Bridge,
  savedText: string,
  testedText: string,
  removedText: string,
  setProvider: (provider: Provider) => void,
  setWorking: (value: string) => void,
  setMessage: (value: ProviderMessage | null) => void,
  onConfigured?: (provider: Provider | 'offline') => void,
) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [modelList, setModelList] = useState<string[]>([]);
  const { setKey: bridgeSetKey, deleteKey: bridgeDeleteKey, test, models } = bridge;

  const chooseModel = useCallback((value: string | null) => {
    setModel(value);
    void setSetting(id, { model: value ?? '' });
  }, [id]);

  const save = useCallback(async () => {
    setWorking(id);
    setMessage(null);
    try {
      if (key.trim()) await bridgeSetKey(key);
      const fetchedModels = await models();
      setModelList(fetchedModels);
      const selected = model && fetchedModels.includes(model) ? model : fetchedModels[0] ?? null;
      if (selected) {
        setModel(selected);
        await setSetting(id, { model: selected });
      }
      await setSetting('activeProvider', id);
      setProvider(id);
      const connected = await test();
      setKey('');
      setMessage({
        color: connected ? 'green' : 'yellow',
        text: connected ? testedText : savedText,
      });
      onConfigured?.(id);
    } catch (reason) {
      setMessage({ color: 'red', text: errorMessage(reason) });
    } finally {
      setWorking('');
    }
  }, [
    id, key, model, bridgeSetKey, models, test, savedText, testedText,
    setProvider, setWorking, setMessage, onConfigured,
  ]);

  const remove = useCallback(async () => {
    await bridgeDeleteKey();
    setModelList([]);
    setMessage({ color: 'green', text: removedText });
    onConfigured?.('offline');
  }, [bridgeDeleteKey, removedText, setMessage, onConfigured]);

  return { key, setKey, model, setModel, modelList, chooseModel, save, remove };
}
