import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Field } from './Field';
import { PasswordField } from './PasswordField';
import { ModelSelect } from './ModelSelect';

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
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  return (
    <div className="rounded-xl border border-ledger-line bg-ledger-surface p-4">
      <Field label={t('apiKey')} description={keyLabelDetail}>
        {({ id, descriptionId }) => (
          <PasswordField
            id={id}
            descriptionId={descriptionId}
            placeholder={keyPlaceholder}
            value={keyValue}
            onChange={onKeyChange}
          />
        )}
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
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="default" disabled={working || (!keyValue.trim() && !hasKey)} onClick={onSave}>
          {working && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
          {t('saveAndTest')}
        </Button>
        {hasKey && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingRemove(true)}>
            <span className="text-ledger-danger">{t('remove')}</span>
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmingRemove}
        title={t('confirmRemoveKeyTitle')}
        description={t('confirmRemoveKeyBody', { provider: t('apiKey') })}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        onCancel={() => setConfirmingRemove(false)}
        onConfirm={() => { setConfirmingRemove(false); onRemove(); }}
      />
    </div>
  );
}
