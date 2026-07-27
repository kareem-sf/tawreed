import { useCallback, useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Button,
  Group,
  Loader,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  useMantineColorScheme,
} from '@mantine/core';
import {
  CheckCircle2,
  Circle,
  Cloud,
  HardDrive,
  PlayCircle,
  RefreshCw,
  Settings2,
} from 'lucide-react';
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
} from '../bridge';

type Provider = 'codex' | 'anthropic' | 'compatible';
type ProcessingMode = 'ask' | 'online' | 'offline';

interface ProviderSetupProps {
  hasKey: boolean;
  hasCompatibleKey: boolean;
  onConfigured?: (provider: Provider | 'offline') => void;
}

interface CompatibleSettings {
  baseUrl: string;
  model: string;
}

export function ProviderSetup({
  hasKey,
  hasCompatibleKey,
  onConfigured,
}: ProviderSetupProps) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<Provider>('codex');
  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [compatibleKey, setCompatibleKey] = useState('');
  const [compatible, setCompatible] = useState<CompatibleSettings>({ baseUrl: '', model: '' });
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState<{ color: string; text: string } | null>(null);

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
    if (!codex?.authenticated) return;
    void codexModels().then(setModels).catch(() => setModels([]));
  }, [codex?.authenticated]);

  const selectProvider = async (next: Provider) => {
    setProvider(next);
    await setSetting('activeProvider', next);
  };

  const installCodex = async () => {
    setWorking('codex-install');
    setMessage(null);
    try {
      await codexInstall();
      await refreshCodex();
    } catch (reason) {
      setMessage({ color: 'red', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setWorking('');
    }
  };

  const loginCodex = async () => {
    setWorking('codex-login');
    setMessage(null);
    try {
      await codexLogin();
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const status = await refreshCodex();
        if (status?.authenticated) break;
      }
    } catch (reason) {
      setMessage({ color: 'red', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setWorking('');
    }
  };

  const saveAnthropic = async () => {
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
      setMessage({ color: 'red', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setWorking('');
    }
  };

  const saveCompatible = async () => {
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
      setMessage({ color: 'red', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setWorking('');
    }
  };

  const connectionCards: Array<{
    value: Provider;
    icon: typeof Cloud;
    title: string;
    detail: string;
    ready: boolean;
  }> = [
    {
      value: 'codex',
      icon: Cloud,
      title: t('chatGptConnection'),
      detail: t('chatGptConnectionDetail'),
      ready: !!codex?.authenticated,
    },
    {
      value: 'anthropic',
      icon: Cloud,
      title: t('anthropicConnection'),
      detail: t('anthropicConnectionDetail'),
      ready: hasKey,
    },
    {
      value: 'compatible',
      icon: Settings2,
      title: t('otherService'),
      detail: t('otherServiceDetail'),
      ready: hasCompatibleKey,
    },
  ];

  return (
    <Stack gap="sm">
      <div className="grid grid-cols-3 gap-2">
        {connectionCards.map((item) => {
          const Icon = item.icon;
          const selected = provider === item.value;
          return (
            <button
              key={item.value}
              type="button"
              className={`rounded-xl border p-3 text-start transition ${
                selected
                  ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-500/10'
                  : 'border-zinc-200 hover:border-zinc-300 dark:border-white/10'
              }`}
              onClick={() => void selectProvider(item.value)}
            >
              <div className="flex items-center justify-between">
                <Icon size={16} className={selected ? 'text-amber-600' : 'text-zinc-400'} />
                {item.ready
                  ? <CheckCircle2 size={14} className="text-emerald-600" />
                  : <Circle size={12} className="text-zinc-300" />}
              </div>
              <div className="mt-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {item.title}
              </div>
              <div className="mt-1 text-[10px] leading-4 text-zinc-500">{item.detail}</div>
            </button>
          );
        })}
      </div>

      {provider === 'codex' && (
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Text size="sm" fw={600}>
                {codex?.authenticated
                  ? t('connectionReady')
                  : codex?.installed
                    ? t('signInRequired')
                    : t('codexNotDetected')}
              </Text>
              {codex?.source && (
                <Text size="xs" c="dimmed" mt={2}>
                  {codex.version} · {codex.source}
                </Text>
              )}
            </div>
            <Group gap="xs">
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                aria-label={t('refreshCodex')}
                onClick={() => void refreshCodex()}
              >
                <RefreshCw size={12} />
              </Button>
              {!codex?.installed && (
                <Button
                  size="xs"
                  color="yellow"
                  loading={working === 'codex-install'}
                  onClick={() => void installCodex()}
                >
                  {t('codexInstall')}
                </Button>
              )}
              {codex?.installed && !codex.authenticated && (
                <Button
                  size="xs"
                  color="yellow"
                  loading={working === 'codex-login'}
                  onClick={() => void loginCodex()}
                >
                  {t('codexLogin')}
                </Button>
              )}
            </Group>
          </div>
          {codex?.authenticated && (
            <Select
              mt="sm"
              label={t('modelChoice')}
              placeholder={t('modelPlaceholder')}
              data={models.map((item) => ({
                value: item.slug,
                label: item.display_name || item.slug,
              }))}
              value={model}
              onChange={(value) => {
                setModel(value);
                void setSetting('model', value ?? '');
              }}
              searchable
              size="xs"
            />
          )}
        </div>
      )}

      {provider === 'anthropic' && (
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <PasswordInput
            label={t('apiKey')}
            description={t('secretStoredSecurely')}
            placeholder="sk-ant-…"
            value={anthropicKey}
            onChange={(event) => setAnthropicKey(event.currentTarget.value)}
            size="xs"
          />
          <Group mt="sm">
            <Button
              size="xs"
              color="yellow"
              loading={working === 'anthropic'}
              disabled={!anthropicKey.trim()}
              onClick={() => void saveAnthropic()}
            >
              {t('saveConnection')}
            </Button>
            {hasKey && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => void deleteApiKey()}
              >
                {t('remove')}
              </Button>
            )}
          </Group>
        </div>
      )}

      {provider === 'compatible' && (
        <Accordion variant="contained">
          <Accordion.Item value="advanced">
            <Accordion.Control>{t('advancedServiceSetup')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <TextInput
                  label={t('serviceUrl')}
                  description={t('serviceUrlDetail')}
                  placeholder="https://service.example"
                  value={compatible.baseUrl}
                  onChange={(event) => setCompatible((current) => ({
                    ...current,
                    baseUrl: event.currentTarget.value,
                  }))}
                  size="xs"
                />
                <TextInput
                  label={t('serviceModel')}
                  value={compatible.model}
                  onChange={(event) => setCompatible((current) => ({
                    ...current,
                    model: event.currentTarget.value,
                  }))}
                  size="xs"
                />
                <PasswordInput
                  label={t('apiKey')}
                  description={t('secretStoredSecurely')}
                  value={compatibleKey}
                  onChange={(event) => setCompatibleKey(event.currentTarget.value)}
                  size="xs"
                />
                <Group mt="xs">
                  <Button
                    size="xs"
                    color="yellow"
                    loading={working === 'compatible'}
                    disabled={
                      !compatible.baseUrl.trim()
                      || !compatible.model.trim()
                      || (!compatibleKey.trim() && !hasCompatibleKey)
                    }
                    onClick={() => void saveCompatible()}
                  >
                    {t('saveAndTest')}
                  </Button>
                  {hasCompatibleKey && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => void deleteCompatibleApiKey()}
                    >
                      {t('remove')}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {message && <Alert color={message.color} p="xs"><Text size="xs">{message.text}</Text></Alert>}
    </Stack>
  );
}

interface Props {
  hasKey: boolean;
  hasCompatibleKey: boolean;
  onOpenAbout: () => void;
  onRunOnboarding: () => void;
}

export default function SettingsModal({
  hasKey,
  hasCompatibleKey,
  onOpenAbout,
  onRunOnboarding,
}: Props) {
  const { t, i18n } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('ask');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getSettings()
      .then((settings) => {
        if (
          settings.processingMode === 'ask'
          || settings.processingMode === 'online'
          || settings.processingMode === 'offline'
        ) {
          setProcessingMode(settings.processingMode);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const changeLanguage = async (language: string) => {
    await i18n.changeLanguage(language);
    await setSetting('language', language);
  };

  return (
    <Stack gap="lg">
      <Text size="xs" c="dimmed">{t('settingsSimpleDetail')}</Text>

      <section>
        <Text size="xs" fw={650} mb={6}>{t('language')}</Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={i18n.language === 'ar' ? 'ar' : 'en'}
          onChange={(value) => void changeLanguage(value)}
          data={[
            { value: 'en', label: 'English' },
            { value: 'ar', label: 'العربية' },
          ]}
        />
      </section>

      <section>
        <Text size="xs" fw={650} mb={6}>{t('appearance')}</Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={colorScheme}
          onChange={(value) => {
            const scheme = value as 'auto' | 'light' | 'dark';
            setColorScheme(scheme);
            void setSetting('theme', scheme);
          }}
          data={[
            { value: 'auto', label: t('systemTheme') },
            { value: 'light', label: t('lightTheme') },
            { value: 'dark', label: t('darkTheme') },
          ]}
        />
      </section>

      <section>
        <Text size="xs" fw={650}>{t('processingChoice')}</Text>
        <Text size="xs" c="dimmed" mt={2} mb={7}>{t('processingChoiceDetail')}</Text>
        {loading ? (
          <Loader size={16} color="yellow" />
        ) : (
          <Select
            size="xs"
            value={processingMode}
            allowDeselect={false}
            data={[
              { value: 'ask', label: t('askEveryFile') },
              { value: 'online', label: t('alwaysImproveOnline') },
              { value: 'offline', label: t('alwaysOffline') },
            ]}
            onChange={(value) => {
              const next = (value ?? 'ask') as ProcessingMode;
              setProcessingMode(next);
              void setSetting('processingMode', next);
            }}
          />
        )}
      </section>

      <section>
        <Text size="xs" fw={650}>{t('connection')}</Text>
        <Text size="xs" c="dimmed" mt={2} mb={8}>{t('connectionDetail')}</Text>
        <ProviderSetup hasKey={hasKey} hasCompatibleKey={hasCompatibleKey} />
      </section>

      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-4 dark:border-white/10">
        <Button
          variant="light"
          color="gray"
          leftSection={<PlayCircle size={14} />}
          onClick={onRunOnboarding}
        >
          {t('viewGuide')}
        </Button>
        <Button
          variant="light"
          color="gray"
          leftSection={<HardDrive size={14} />}
          onClick={onOpenAbout}
        >
          {t('about')}
        </Button>
      </div>
    </Stack>
  );
}
