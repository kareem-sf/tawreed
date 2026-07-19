import { useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Divider, Group, Loader, PasswordInput, Select, Stack, Text, Title,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  codexInstall, codexLogin, codexModels, codexStatus, deleteApiKey, getSettings,
  setApiKey, setSetting, type CodexStatus, type ModelInfo,
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [model, setModel] = useState<string | null>(null);

  const refreshCodex = () => codexStatus().then(setCodex).catch(() => setCodex(null));

  useEffect(() => {
    refreshCodex();
    getSettings().then((s) => {
      if (typeof s.model === 'string' && s.model) setModel(s.model);
    });
  }, []);

  useEffect(() => {
    if (!codex?.authenticated) return;
    setModelsLoading(true);
    codexModels()
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [codex?.authenticated]);

  useEffect(() => {
    if (status !== 'idle') {
      const timer = window.setTimeout(() => setStatus('idle'), 3000);
      return () => window.clearTimeout(timer);
    }
  }, [status]);

  const save = async () => {
    try { await setApiKey(key); setKey(''); setKeySaved(true); setStatus('saved'); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setStatus('error'); }
  };
  const remove = async () => {
    try { await deleteApiKey(); setKeySaved(false); setStatus('removed'); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setStatus('error'); }
  };
  const install = async () => {
    setInstalling(true);
    try { await codexInstall(); await refreshCodex(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setStatus('error'); }
    finally { setInstalling(false); }
  };
  const login = async () => {
    try { await codexLogin(); await refreshCodex(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setStatus('error'); }
  };
  const pickModel = async (slug: string | null) => {
    setModel(slug);
    try { await setSetting('model', slug ?? ''); } catch { /* non-fatal */ }
  };

  const selectedInfo = models.find((m) => m.slug === model);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={5}>{t('codexTitle')}</Title>
        <Button variant="subtle" size="compact-xs" onClick={onOpenAbout}>{t('about')}</Button>
      </Group>
      <Text size="xs" c="dimmed">{t('codexDesc')}</Text>
      <Group gap="xs">
        {codex?.installed ? (
          <>
            <Badge color="green" variant="light">{t('codexDetected')} · {codex.version}</Badge>
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
            <Button color="yellow" size="xs" onClick={login}>{t('codexLogin')}</Button>
            <Button variant="subtle" size="compact-xs" onClick={refreshCodex}>↻</Button>
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
            data={models.map((m) => ({ value: m.slug, label: m.display_name || m.slug }))}
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
        onChange={(e) => setKey(e.currentTarget.value)}
        size="xs"
      />
      <Text size="xs" c="dimmed">{t('apiKeyHint', { path: [dataDir, '.env'].join('/') })}</Text>
      <Group>
        <Button color="yellow" size="xs" onClick={save} disabled={!key.trim()}>{t('save')}</Button>
        {(keySaved || hasKey) && <Button variant="subtle" color="red" size="xs" onClick={remove}>{t('remove')}</Button>}
      </Group>

      {status === 'saved' && <Alert color="green" p="xs"><Text size="xs">{t('keySaved')}</Text></Alert>}
      {status === 'removed' && <Alert color="yellow" p="xs"><Text size="xs">{t('keyRemoved')}</Text></Alert>}
      {status === 'error' && <Alert color="red" p="xs"><Text size="xs">{error}</Text></Alert>}
    </Stack>
  );
}
