import {
  Accordion,
  Alert,
  Button,
  Group,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { CheckCircle2, Circle, Cloud, RefreshCw, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NamedProviderCard } from './NamedProviderCard';
import type { Provider } from './provider-types';
import { useProviderSetup } from './useProviderSetup';

interface Props {
  hasKey: boolean;
  hasCompatibleKey: boolean;
  hasGeminiKey?: boolean;
  hasGrokKey?: boolean;
  onConfigured?: (provider: Provider | 'offline') => void;
}

export function ProviderSetup({
  hasKey, hasCompatibleKey, hasGeminiKey = false, hasGrokKey = false, onConfigured,
}: Props) {
  const { t } = useTranslation();
  const setup = useProviderSetup({ onConfigured });
  const connectionCards = [
    {
      value: 'codex' as const,
      icon: Cloud,
      title: t('chatGptConnection'),
      detail: t('chatGptConnectionDetail'),
      ready: Boolean(setup.codex?.authenticated),
    },
    {
      value: 'anthropic' as const,
      icon: Cloud,
      title: t('anthropicConnection'),
      detail: t('anthropicConnectionDetail'),
      ready: hasKey,
    },
    {
      value: 'gemini' as const,
      icon: Cloud,
      title: t('geminiConnection'),
      detail: t('geminiConnectionDetail'),
      ready: hasGeminiKey,
    },
    {
      value: 'grok' as const,
      icon: Cloud,
      title: t('grokConnection'),
      detail: t('grokConnectionDetail'),
      ready: hasGrokKey,
    },
    {
      value: 'compatible' as const,
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
          const selected = setup.provider === item.value;
          return (
            <button
              key={item.value}
              type="button"
              className={`rounded-xl border p-3 text-start transition ${
                selected
                  ? 'border-gold-deep bg-gold/8 dark:border-gold'
                  : 'border-ledger-line hover:border-gold-deep/60'
              }`}
              aria-pressed={selected}
              onClick={() => void setup.selectProvider(item.value)}
            >
              <div className="flex items-center justify-between">
                <Icon size={16} className={selected ? 'text-gold-deep dark:text-gold' : 'text-ledger-ink-faint'} aria-hidden="true" />
                {item.ready
                  ? <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />
                  : <Circle size={12} className="text-zinc-300" aria-hidden="true" />}
              </div>
              <div className="mt-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {item.title}
              </div>
              <div className="mt-1 text-[10px] leading-4 text-zinc-500">{item.detail}</div>
            </button>
          );
        })}
      </div>

      {setup.provider === 'codex' && (
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Text size="sm" fw={600}>
                {setup.codex?.authenticated
                  ? t('connectionReady')
                  : setup.codex?.installed
                    ? t('signInRequired')
                    : t('codexNotDetected')}
              </Text>
              {setup.codex?.source && (
                <Text size="xs" c="dimmed" mt={2}>
                  {setup.codex.version} · {setup.codex.source}
                </Text>
              )}
            </div>
            <Group gap="xs">
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                aria-label={t('refreshCodex')}
                onClick={() => void setup.refreshCodex()}
              >
                <RefreshCw size={12} aria-hidden="true" />
              </Button>
              {!setup.codex?.installed && (
                <Button
                  size="xs"
                  color="gold"
                  loading={setup.working === 'codex-install'}
                  onClick={() => void setup.installCodex()}
                >
                  {t('codexInstall')}
                </Button>
              )}
              {setup.codex?.installed && !setup.codex.authenticated && (
                <Button
                  size="xs"
                  color="gold"
                  loading={setup.working === 'codex-login'}
                  onClick={() => void setup.loginCodex()}
                >
                  {t('codexLogin')}
                </Button>
              )}
            </Group>
          </div>
          {setup.codex?.authenticated && (
            <Select
              mt="sm"
              label={t('modelChoice')}
              placeholder={t('modelPlaceholder')}
              data={setup.models.map((item) => ({
                value: item.slug,
                label: item.display_name || item.slug,
              }))}
              value={setup.model}
              onChange={setup.chooseModel}
              searchable
              size="xs"
            />
          )}
        </div>
      )}

      {setup.provider === 'anthropic' && (
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <PasswordInput
            label={t('apiKey')}
            description={t('secretStoredSecurely')}
            placeholder="sk-ant-…"
            value={setup.anthropicKey}
            onChange={(event) => setup.setAnthropicKey(event.currentTarget.value)}
            size="xs"
          />
          <Group mt="sm">
            <Button
              size="xs"
              color="gold"
              loading={setup.working === 'anthropic'}
              disabled={!setup.anthropicKey.trim()}
              onClick={() => void setup.saveAnthropic()}
            >
              {t('saveConnection')}
            </Button>
            {hasKey && (
              <Button size="xs" variant="subtle" color="red" onClick={() => void setup.removeAnthropic()}>
                {t('remove')}
              </Button>
            )}
          </Group>
        </div>
      )}

      {setup.provider === 'gemini' && (
        <NamedProviderCard
          keyLabelDetail={t('geminiKeyDetail')}
          keyPlaceholder="AIza…"
          keyValue={setup.geminiKey}
          onKeyChange={setup.setGeminiKey}
          modelList={setup.geminiModelList}
          model={setup.geminiModel}
          onModelChange={setup.chooseGeminiModel}
          working={setup.working === 'gemini'}
          hasKey={hasGeminiKey}
          onSave={() => void setup.saveGemini()}
          onRemove={() => void setup.removeGemini()}
        />
      )}

      {setup.provider === 'grok' && (
        <NamedProviderCard
          keyLabelDetail={t('grokKeyDetail')}
          keyPlaceholder="xai-…"
          keyValue={setup.grokKey}
          onKeyChange={setup.setGrokKey}
          modelList={setup.grokModelList}
          model={setup.grokModel}
          onModelChange={setup.chooseGrokModel}
          working={setup.working === 'grok'}
          hasKey={hasGrokKey}
          onSave={() => void setup.saveGrok()}
          onRemove={() => void setup.removeGrok()}
        />
      )}

      {setup.provider === 'compatible' && (
        <Accordion variant="contained">
          <Accordion.Item value="advanced">
            <Accordion.Control>{t('advancedServiceSetup')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <TextInput
                  label={t('serviceUrl')}
                  description={t('serviceUrlDetail')}
                  placeholder="https://service.example"
                  value={setup.compatible.baseUrl}
                  onChange={(event) => setup.setCompatible((current) => ({
                    ...current,
                    baseUrl: event.currentTarget.value,
                  }))}
                  size="xs"
                />
                <TextInput
                  label={t('serviceModel')}
                  value={setup.compatible.model}
                  onChange={(event) => setup.setCompatible((current) => ({
                    ...current,
                    model: event.currentTarget.value,
                  }))}
                  size="xs"
                />
                <PasswordInput
                  label={t('apiKey')}
                  description={t('secretStoredSecurely')}
                  value={setup.compatibleKey}
                  onChange={(event) => setup.setCompatibleKey(event.currentTarget.value)}
                  size="xs"
                />
                <Group mt="xs">
                  <Button
                    size="xs"
                    color="gold"
                    loading={setup.working === 'compatible'}
                    disabled={
                      !setup.compatible.baseUrl.trim()
                      || !setup.compatible.model.trim()
                      || (!setup.compatibleKey.trim() && !hasCompatibleKey)
                    }
                    onClick={() => void setup.saveCompatible()}
                  >
                    {t('saveAndTest')}
                  </Button>
                  {hasCompatibleKey && (
                    <Button size="xs" variant="subtle" color="red" onClick={() => void setup.removeCompatible()}>
                      {t('remove')}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {setup.message && (
        <Alert color={setup.message.color} p="xs">
          <Text size="xs">{setup.message.text}</Text>
        </Alert>
      )}
    </Stack>
  );
}
