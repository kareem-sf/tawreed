import type { ComponentType } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Anthropic, Codex, Gemini, Grok } from 'modelicons';
import { Field, FieldLabel } from '../../components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { Provider } from './provider-types';
import type { useProviderSetup } from './useProviderSetup';

type Setup = ReturnType<typeof useProviderSetup>;

interface Props {
  setup: Setup;
  hasKey: boolean;
  hasCompatibleKey: boolean;
  hasGeminiKey: boolean;
  hasGrokKey: boolean;
}

type BrandIcon = ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/** Provider picker: a single dropdown with real brand marks (modelicons,
 * mono = currentColor, theme-safe). The selected provider's setup form
 * renders below it; readiness shows as a quiet dot on the option. */
export function ConnectionCards({ setup, hasKey, hasCompatibleKey, hasGeminiKey, hasGrokKey }: Props) {
  const { t } = useTranslation();
  const options: { value: Provider; label: string; ready: boolean; Icon: BrandIcon }[] = [
    { value: 'codex', label: t('chatGptConnection'), ready: Boolean(setup.codex?.authenticated), Icon: Codex },
    { value: 'anthropic', label: t('anthropicConnection'), ready: hasKey, Icon: Anthropic },
    { value: 'gemini', label: t('geminiConnection'), ready: hasGeminiKey, Icon: Gemini },
    { value: 'grok', label: t('grokConnection'), ready: hasGrokKey, Icon: Grok },
    { value: 'compatible', label: t('otherService'), ready: hasCompatibleKey, Icon: Settings2 },
  ];

  return (
    <Field>
      <FieldLabel htmlFor="provider-select">{t('provider')}</FieldLabel>
      <Select
        value={setup.provider}
        onValueChange={(value) => void setup.selectProvider(value as Provider)}
      >
        <SelectTrigger id="provider-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2 text-muted-foreground">
                <option.Icon size={14} className="shrink-0" aria-hidden="true" />
                <span className="truncate text-foreground">{option.label}</span>
                {option.ready && (
                  <>
                    <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
                    <span className="sr-only">{t('connectionReady')}</span>
                  </>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
