import { Button, Group, PasswordInput, Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';

interface Props {
  keyLabelDetail: string;
  keyPlaceholder: string;
  keyValue: string;
  onKeyChange: (value: string) => void;
  modelList: string[];
  model: string | null;
  onModelChange: (value: string | null) => void;
  working: boolean;
  hasKey: boolean;
  onSave: () => void;
  onRemove: () => void;
}

/** Shared card body for a named BYOK provider (Gemini, Grok, …) — key field, fetched
 * model catalog, save/test/remove. Mirrors the Anthropic card's layout. */
export function NamedProviderCard({
  keyLabelDetail, keyPlaceholder, keyValue, onKeyChange,
  modelList, model, onModelChange, working, hasKey, onSave, onRemove,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <PasswordInput
        label={t('apiKey')}
        description={keyLabelDetail}
        placeholder={keyPlaceholder}
        value={keyValue}
        onChange={(event) => onKeyChange(event.currentTarget.value)}
        size="xs"
      />
      {modelList.length > 0 && (
        <Select
          mt="sm"
          label={t('modelChoice')}
          placeholder={t('modelPlaceholder')}
          data={modelList}
          value={model}
          onChange={onModelChange}
          searchable
          size="xs"
        />
      )}
      <Group mt="sm">
        <Button size="xs" color="gold" loading={working} disabled={!keyValue.trim() && !hasKey} onClick={onSave}>
          {t('saveAndTest')}
        </Button>
        {hasKey && (
          <Button size="xs" variant="subtle" color="red" onClick={onRemove}>
            {t('remove')}
          </Button>
        )}
      </Group>
    </div>
  );
}
