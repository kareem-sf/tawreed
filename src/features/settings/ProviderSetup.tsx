import { CheckCircle2, Circle, Cloud, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Input } from '../../components/ui/input';
import { Field } from './Field';
import { ModelSelect } from './ModelSelect';
import { NamedProviderCard } from './NamedProviderCard';
import { PasswordField } from './PasswordField';
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
  const [pendingRemove, setPendingRemove] = useState<'anthropic' | 'compatible' | null>(null);
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

  const messageTone = setup.message?.color === 'red'
    ? undefined
    : setup.message?.color === 'green'
      ? 'border-emerald-600/30 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300'
      : 'border-amber-500/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-300';

  return (
    <div className="space-y-3">
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
        <div className="rounded-xl border border-ledger-line bg-ledger-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ledger-ink">
                {setup.codex?.authenticated
                  ? t('connectionReady')
                  : setup.codex?.installed
                    ? t('signInRequired')
                    : t('codexNotDetected')}
              </p>
              {setup.codex?.source && (
                <p className="mt-0.5 text-xs text-ledger-ink-dim">
                  {setup.codex.version} · {setup.codex.source}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={t('refreshCodex')}
                onClick={() => void setup.refreshCodex()}
              >
                <RefreshCw size={12} aria-hidden="true" />
              </Button>
              {!setup.codex?.installed && (
                <Button
                  size="sm"
                  variant="default"
                  disabled={setup.working === 'codex-install'}
                  onClick={() => void setup.installCodex()}
                >
                  {setup.working === 'codex-install'
                    && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
                  {t('codexInstall')}
                </Button>
              )}
              {setup.codex?.installed && !setup.codex.authenticated && (
                <Button
                  size="sm"
                  variant="default"
                  disabled={setup.working === 'codex-login'}
                  onClick={() => void setup.loginCodex()}
                >
                  {setup.working === 'codex-login'
                    && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
                  {t('codexLogin')}
                </Button>
              )}
            </div>
          </div>
          {setup.codex?.authenticated && (
            <div className="mt-3">
              <ModelSelect
                label={t('modelChoice')}
                placeholder={t('modelPlaceholder')}
                options={setup.models.map((item) => ({
                  value: item.slug,
                  label: item.display_name || item.slug,
                }))}
                value={setup.model}
                onChange={setup.chooseModel}
              />
            </div>
          )}
        </div>
      )}

      {setup.provider === 'anthropic' && (
        <div className="rounded-xl border border-ledger-line bg-ledger-surface p-4">
          <Field label={t('apiKey')} description={t('secretStoredSecurely')}>
            {({ id, descriptionId }) => (
              <PasswordField
                id={id}
                descriptionId={descriptionId}
                placeholder="sk-ant-…"
                value={setup.anthropicKey}
                onChange={setup.setAnthropicKey}
              />
            )}
          </Field>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={setup.working === 'anthropic' || !setup.anthropicKey.trim()}
              onClick={() => void setup.saveAnthropic()}
            >
              {setup.working === 'anthropic'
                && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
              {t('saveConnection')}
            </Button>
            {hasKey && (
              <Button size="sm" variant="ghost" onClick={() => setPendingRemove('anthropic')}>
                <span className="text-ledger-danger">{t('remove')}</span>
              </Button>
            )}
          </div>
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
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced" className="rounded-xl border border-ledger-line bg-ledger-surface px-4">
            <AccordionTrigger className="py-3">{t('advancedServiceSetup')}</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2.5">
                <Field label={t('serviceUrl')} description={t('serviceUrlDetail')}>
                  {({ id, descriptionId }) => (
                    <Input
                      id={id}
                      aria-describedby={descriptionId}
                      placeholder="https://service.example"
                      autoComplete="off"
                      spellCheck={false}
                      value={setup.compatible.baseUrl}
                      onChange={(event) => setup.setCompatible((current) => ({
                        ...current,
                        baseUrl: event.currentTarget.value,
                      }))}
                    />
                  )}
                </Field>
                <Field label={t('serviceModel')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      autoComplete="off"
                      spellCheck={false}
                      value={setup.compatible.model}
                      onChange={(event) => setup.setCompatible((current) => ({
                        ...current,
                        model: event.currentTarget.value,
                      }))}
                    />
                  )}
                </Field>
                <Field label={t('apiKey')} description={t('secretStoredSecurely')}>
                  {({ id, descriptionId }) => (
                    <PasswordField
                      id={id}
                      descriptionId={descriptionId}
                      value={setup.compatibleKey}
                      onChange={setup.setCompatibleKey}
                    />
                  )}
                </Field>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={
                      setup.working === 'compatible'
                      || !setup.compatible.baseUrl.trim()
                      || !setup.compatible.model.trim()
                      || (!setup.compatibleKey.trim() && !hasCompatibleKey)
                    }
                    onClick={() => void setup.saveCompatible()}
                  >
                    {setup.working === 'compatible'
                      && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
                    {t('saveAndTest')}
                  </Button>
                  {hasCompatibleKey && (
                    <Button size="sm" variant="ghost" onClick={() => setPendingRemove('compatible')}>
                      <span className="text-ledger-danger">{t('remove')}</span>
                    </Button>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {setup.message && (
        <Alert variant={setup.message.color === 'red' ? 'destructive' : 'default'} className={cn('text-xs', messageTone)}>
          {setup.message.text}
        </Alert>
      )}
      <ConfirmDialog
        open={pendingRemove !== null}
        title={t('confirmRemoveKeyTitle')}
        description={pendingRemove ? t('confirmRemoveKeyBody', {
          provider: pendingRemove === 'anthropic' ? t('anthropicConnection') : t('otherService'),
        }) : undefined}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          const target = pendingRemove;
          setPendingRemove(null);
          if (target === 'anthropic') void setup.removeAnthropic();
          else if (target === 'compatible') void setup.removeCompatible();
        }}
      />
    </div>
  );
}
