import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../../components/ui/input-group';

interface PasswordFieldProps {
  id: string;
  descriptionId?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

/** Password input with a visibility toggle. Matches the former Mantine
 * PasswordInput behavior (masked by default, toggle to reveal). */
export function PasswordField({ id, descriptionId, value, placeholder, onChange }: PasswordFieldProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        aria-describedby={descriptionId}
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label={visible ? t('hideApiKey') : t('showApiKey')}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible
            ? <EyeOff size={15} aria-hidden="true" />
            : <Eye size={15} aria-hidden="true" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
