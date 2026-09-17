import { useId, type ReactNode } from 'react';
import { Label } from '../../components/ui/label';

interface FieldProps {
  label: string;
  description?: string;
  children: (ids: { id: string; descriptionId: string }) => ReactNode;
}

/** Label + description wrapper that wires label association for its input.
 * The description id is passed through so inputs can set aria-describedby. */
export function Field({ label, description, children }: FieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, descriptionId })}
      {description && (
        <p id={descriptionId} className="text-xs leading-4 text-ledger-ink-dim">
          {description}
        </p>
      )}
    </div>
  );
}
