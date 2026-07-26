import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  PasswordInput,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  codexInstall,
  codexLogin,
  codexModels,
  codexStatus,
  deleteApiKey,
  getSettings,
  setApiKey,
  setSetting,
  type CodexStatus,
  type ModelInfo,
} from '../bridge';

interface Props {
  dataDir: string;
  hasKey: boolean;
  onOpenAbout: () => void;
}

export default function SettingsModal({ dataDir, hasKey, onOpenAbout }: Props) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'removed' | 'error'>('idle');
  const [error, setError] = useState('');
  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>('auto');

  const refreshCodex = useCallback(async () => {
    try {
      const current = await codexStatus();
      setCodex(current);
      return current;
    } catch {
      setCodex(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshCodex();
    void getSettings().then((settings) => {
      if (typeof settings.model === 'string' && settings.model) setModel(settings.model);
      if (
        typeof settings.provider === 'string'
        && ['auto', 'codex', 'anthropic', 'offline'].includes(settings.provider)
      ) {
        setProvider(settings.provider);
      }
    });
  }, [refreshCodex]);

  useEffect(() => {
    if (!loginPending) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void refreshCodex().then((current) => {
        if (current?.authenticated || attempts >= 60) {
          setLoginPending(false);
          window.clearInterval(timer);
        }
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [loginPending, refreshCodex]);

  useEffect(() => {
    if (!codex?.authenticated) return;
    setModelsLoading(true);
    void codexModels()
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [codex?.authenticated]);

  useEffect(() => {
    if (status === 'idle') return;
    const timer = window.setTimeout(() => setStatus('idle'), 3_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const save = async () => {
    try {
      await setApiKey(key);
      setKey('');
      setKeySaved(true);
      setStatus('saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    }
  };

  const remove = async () => {
    try {
      await deleteApiKey();
      setKeySaved(false);
      setStatus('removed');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    }
  };

  const install = async () => {
    setInstalling(true);
    try {
      await codexInstall();
      await refreshCodex();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    } finally {
      setInstalling(false);
    }
  };

  const login = async () => {
    try {
      await codexLogin();
      setLoginPending(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    }
  };

  const pickModel = async (slug: string | null) => {
    setModel(slug);
    try {
      await setSetting('model', slug ?? '');
    } catch {
      // The current session can still use the selected model.
    }
  };

  const pickProvider = async (value: string | null) => {
    const next = value ?? 'auto';
    setProvider(next);
    try {
      await setSetting('provider', next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    }
  };

  const selectedInfo = models.find((candidate) => candidate.slug === model);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={5}>{t('codexTitle')}</Title>
        <Button variant="subtle" size="compact-xs" onClick={onOpenAbout}>{t('about')}</Button>
      </Group>

      <Select
        label={<Text size="xs" fw={600}>{t('provider')}</Text>}
        description={t('providerDetail')}
        data={[
          { value: 'auto', label: t('providerAuto') },
          { value: 'codex', label: t('providerCodex') },
          { value: 'anthropic', label: t('providerAnthropic') },
          { value: 'offline', label: t('providerOffline') },
        ]}
        value={provider}
        onChange={pickProvider}
        allowDeselect={false}
        size="xs"
      />

      <Text size="xs" c="dimmed">{t('codexDesc')}</Text>
      <Group gap="xs">
        {codex?.installed ? (
          <>
            <Badge color="green" variant="light">
              {t('codexDetected')}{codex.version ? ` · ${codex.version}` : ''}
            </Badge>
            {codex.authenticated
              ? <Badge color="green">{t('codexAuthed')}</Badge>
              : <Badge color="yellow">{t('codexNotAuthed')}</Badge>}
          </>
        ) : (
          <Badge color="gray">{t('codexNotDetected')}</Badge>
        )}
      </Group>

      <Group>
        {!codex?.installed && (
          <Button color="yellow" size="xs" onClick={install} loading={installing}>
            {installing ? t('codexInstalling') : t('codexInstall')}
          </Button>
        )}
        {codex?.installed && !codex.authenticated && (
          <>
            <Button color="yellow" size="xs" onClick={login} loading={loginPending}>
              {t('codexLogin')}
            </Button>
            <Button
              variant="subtle"
              size="compact-xs"
              aria-label={t('refreshCodex')}
              onClick={() => void refreshCodex()}
            >
              ↻
            </Button>
          </>
        )}
      </Group>
      {codex?.installed && !codex.authenticated && (
        <Text size="xs" c="dimmed">{t('codexLoginHint')}</Text>
      )}

      {codex?.authenticated && (
        <>
          <Select
            label={<Text size="xs" fw={600}>{t('model')}</Text>}
            placeholder={modelsLoading ? t('modelsLoading') : t('modelPlaceholder')}
            data={models.map((candidate) => ({
              value: candidate.slug,
              label: candidate.display_name || candidate.slug,
            }))}
            value={model}
            onChange={pickModel}
            disabled={modelsLoading || models.length === 0}
            rightSection={modelsLoading ? <Loader size={12} color="yellow" /> : undefined}
            size="xs"
            searchable
          />
          {selectedInfo && (
            <Text size="xs" c="dimmed" lh={1.4}>{selectedInfo.description}</Text>
          )}
        </>
      )}

      <Divider label={t('orApiKey')} labelPosition="center" />

      <PasswordInput
        label={t('apiKey')}
        placeholder="sk-ant-…"
        value={key}
        onChange={(event) => setKey(event.currentTarget.value)}
        size="xs"
      />
      <Text size="xs" c="dimmed">{t('apiKeyHint', { path: [dataDir, '.env'].join('/') })}</Text>
      <Group>
        <Button color="yellow" size="xs" onClick={save} disabled={!key.trim()}>{t('save')}</Button>
        {(keySaved || hasKey) && (
          <Button variant="subtle" color="red" size="xs" onClick={remove}>{t('remove')}</Button>
        )}
      </Group>

      {status === 'saved' && (
        <Alert color="green" p="xs"><Text size="xs">{t('keySaved')}</Text></Alert>
      )}
      {status === 'removed' && (
        <Alert color="yellow" p="xs"><Text size="xs">{t('keyRemoved')}</Text></Alert>
      )}
      {status === 'error' && (
        <Alert color="red" p="xs"><Text size="xs">{error}</Text></Alert>
      )}
    </Stack>
  );
}
