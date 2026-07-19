import { useRef, useState } from 'react';
import { Paper, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function DropZone({ onFile, compact }: { onFile: (f: File) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <Paper
      withBorder
      p={compact ? 'md' : 40}
      ta="center"
      style={{
        borderStyle: 'dashed',
        borderColor: over ? 'var(--mantine-color-yellow-4)' : 'var(--mantine-color-dark-4)',
        cursor: 'pointer',
      }}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <Text fz={compact ? 18 : 30}>⇪</Text>
      <Text size={compact ? 'xs' : 'sm'} c="dimmed">{t('dropToStart')}</Text>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </Paper>
  );
}
