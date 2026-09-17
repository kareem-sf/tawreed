import { useId, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/ui/command';

export interface ModelOption {
  value: string;
  label: string;
}

interface ModelSelectProps {
  /** Visible label. Omit for compact contexts (table rows) and pass
   * `ariaLabel` instead — the trigger always carries text content. */
  label?: string;
  ariaLabel?: string;
  placeholder: string;
  options: ModelOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}

/** Searchable single-select for model catalogs (combobox pattern).
 * Replaces the Mantine searchable Select: same value/onChange contract,
 * type-to-filter, keyboard navigation via cmdk, listbox semantics. */
export function ModelSelect({ label, ariaLabel, placeholder, options, value, onChange }: ModelSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const selected = options.find((option) => option.value === value) ?? null;

  const popover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : ariaLabel}
          className="w-full justify-between text-start font-normal"
        >
          {selected
            ? <span className="truncate">{selected.label}</span>
            : <span className="truncate text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown size={14} className="shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] border-ledger-line p-0">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{t('noModelsFound')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    size={14}
                    aria-hidden="true"
                    className={cn('me-2 shrink-0', value === option.value ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  if (!label) return popover;
  return (
    <div className="space-y-1.5">
      <Label id={labelId}>{label}</Label>
      {popover}
    </div>
  );
}
