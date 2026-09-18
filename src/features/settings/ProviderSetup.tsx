import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { CodexPanel } from './CodexPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { ConnectionCards } from './ConnectionCards';
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

  const messageTone = setup.message?.color === 'red'
    ? undefined
    : setup.message?.color === 'green'
      ? 'border-success/30 text-success'
      : 'border-border text-muted-foreground';

  return (
    <div className="space-y-3">
      <ConnectionCards
        setup={setup}
        hasKey={hasKey}
        hasCompatibleKey={hasCompatibleKey}
        hasGeminiKey={hasGeminiKey}
        hasGrokKey={hasGrokKey}
      />

      {setup.provider === 'codex' && <CodexPanel setup={setup} />}

      {setup.provider === 'anthropic' && (
        <div className="rounded-xl border bg-card p-4">
          <Field>
            <FieldLabel htmlFor="anthropic-key">{t('apiKey')}</FieldLabel>
            <PasswordField
              id="anthropic-key"
              descriptionId="anthropic-key-description"
              placeholder="sk-ant-…"
              value={setup.anthropicKey}
              onChange={setup.setAnthropicKey}
            />
            <FieldDescription id="anthropic-key-description" className="text-xs">
              {t('secretStoredSecurely')}
            </FieldDescription>
          </Field>
          <div className="mt-4 flex items-center gap-2">
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
                <span className="text-destructive">{t('remove')}</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {setup.provider === 'gemini' && (
        <NamedProviderCard
          idPrefix="gemini"
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
          idPrefix="grok"
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
          <AccordionItem value="advanced" className="rounded-xl border bg-card px-4">
            <AccordionTrigger className="py-3">{t('advancedServiceSetup')}</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2.5">
                <Field>
                  <FieldLabel htmlFor="compatible-url">{t('serviceUrl')}</FieldLabel>
                  <Input
                    id="compatible-url"
                    aria-describedby="compatible-url-description"
                    placeholder="https://service.example"
                    autoComplete="off"
                    spellCheck={false}
                    value={setup.compatible.baseUrl}
                    onChange={(event) => setup.setCompatible((current) => ({
                      ...current,
                      baseUrl: event.currentTarget.value,
                    }))}
                  />
                  <FieldDescription id="compatible-url-description" className="text-xs">
                    {t('serviceUrlDetail')}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="compatible-model">{t('serviceModel')}</FieldLabel>
                  <Input
                    id="compatible-model"
                    autoComplete="off"
                    spellCheck={false}
                    value={setup.compatible.model}
                    onChange={(event) => setup.setCompatible((current) => ({
                      ...current,
                      model: event.currentTarget.value,
                    }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="compatible-key">{t('apiKey')}</FieldLabel>
                  <PasswordField
                    id="compatible-key"
                    descriptionId="compatible-key-description"
                    value={setup.compatibleKey}
                    onChange={setup.setCompatibleKey}
                  />
                  <FieldDescription id="compatible-key-description" className="text-xs">
                    {t('secretStoredSecurely')}
                  </FieldDescription>
                </Field>
                <div className="flex items-center gap-2 pt-1">
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
                      <span className="text-destructive">{t('remove')}</span>
                    </Button>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {setup.message && (
        <Alert variant={setup.message.color === 'red' ? 'destructive' : 'default'} className={cn('text-xs leading-relaxed', messageTone)}>
          {setup.message.text}
        </Alert>
      )}
      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => { if (!open) setPendingRemove(null); }}
        title={t('confirmRemoveKeyTitle')}
        body={pendingRemove
          ? t('confirmRemoveKeyBody', {
            provider: pendingRemove === 'anthropic' ? t('anthropicConnection') : t('otherService'),
          })
          : null}
        cancelLabel={t('cancel')}
        confirmLabel={t('remove')}
        onConfirm={() => {
          const target = pendingRemove;
          if (target === 'anthropic') void setup.removeAnthropic();
          else if (target === 'compatible') void setup.removeCompatible();
        }}
      />
    </div>
  );
}
