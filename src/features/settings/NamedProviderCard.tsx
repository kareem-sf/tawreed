import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '../../components/ui/field';
import { ConfirmDialog } from './ConfirmDialog';
import { PasswordField } from './PasswordField';
import { ModelSelect } from './ModelSelect';

interface Props {
  idPrefix: string;
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
  idPrefix, keyLabelDetail, keyPlaceholder, keyValue, onKeyChange,
  modelList, model, onModelChange, working, hasKey, onSave, onRemove,
}: Props) {
  const { t } = useTranslation();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  return (
    <div className="rounded-xl border bg-card p-4">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-key`}>{t('apiKey')}</FieldLabel>
        <PasswordField
          id={`${idPrefix}-key`}
          descriptionId={`${idPrefix}-key-description`}
          placeholder={keyPlaceholder}
          value={keyValue}
          onChange={onKeyChange}
        />
        <FieldDescription id={`${idPrefix}-key-description`} className="text-xs">
          {keyLabelDetail}
        </FieldDescription>
      </Field>
      {modelList.length > 0 && (
        <div className="mt-3">
          <ModelSelect
            label={t('modelChoice')}
            placeholder={t('modelPlaceholder')}
            options={modelList.map((item) => ({ value: item, label: item }))}
            value={model}
            onChange={onModelChange}
          />
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="default" disabled={working || (!keyValue.trim() && !hasKey)} onClick={onSave}>
          {working && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
          {t('saveAndTest')}
        </Button>
        {hasKey && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(true)}>
            <span className="text-destructive">{t('remove')}</span>
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={t('confirmRemoveKeyTitle')}
        body={t('confirmRemoveKeyBody', { provider: t('apiKey') })}
        cancelLabel={t('cancel')}
        confirmLabel={t('remove')}
        onConfirm={() => onRemove()}
      />
    </div>
  );
}
