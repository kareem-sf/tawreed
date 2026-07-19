import { Badge, Button, Group, ScrollArea, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { InspectionResult, ValidationIssue, WorkPackage } from '../../shared/types';
import { AnimatedList } from './ui/animated-list';
import { NumberTicker } from './ui/number-ticker';
import { ShimmerButton } from './ui/shimmer-button';

export interface PipelineData {
  inspection: InspectionResult;
  packages: WorkPackage[];
  issues: ValidationIssue[];
  llmUsed: boolean;
  llmFailed: boolean;
  fileName: string;
  bytes: Uint8Array;
  startedAt: number;
}

interface Props {
  data: PipelineData;
  busy: boolean;
  hasErrors: boolean;
  onGenerate: () => void;
  onReset: () => void;
}

const compact = (n: number, locale: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: 'compact' }).format(n);

export default function ReviewPanel({ data, busy, hasErrors, onGenerate, onReset }: Props) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const errors = data.issues.filter((i) => i.severity === 'error');
  const warnings = data.issues.filter((i) => i.severity === 'warning');
  const grand = data.packages.reduce((s, p) => s + p.totalCost, 0);

  return (
    <div className="flex h-full flex-col gap-2.5 px-4 pb-3">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <div className="min-w-0">
          <Text size="sm" fw={600} truncate maw={310}>{data.inspection.projectName}</Text>
          <Text size="9px" c="dimmed">{data.inspection.sourceKind.toUpperCase()} · {data.fileName}</Text>
        </div>
        <Group gap={6} wrap="nowrap">
          {data.llmUsed && (
            <Tooltip label={t('aiEnhancedDetail')} openDelay={180}>
              <Badge size="xs" color="grape" variant="light">{t('aiEnhanced')}</Badge>
            </Tooltip>
          )}
          {data.llmFailed && (
            <Tooltip label={t('aiFailedDetail')} openDelay={180}>
              <Badge size="xs" color="orange" variant="light">{t('aiFailed')}</Badge>
            </Tooltip>
          )}
        </Group>
      </Group>

      <div className="min-h-0 flex-1 rounded-xl bg-white shadow-sm ring-1 ring-zinc-300 dark:bg-white/[0.03] dark:shadow-none dark:ring-white/10">
        <ScrollArea h="100%" offsetScrollbars scrollbarSize={4}>
          <AnimatedList className="gap-0.5 p-1.5" stagger={0.04}>
            {data.packages.map((p) => (
              <Tooltip.Floating key={p.code} label={t('packageDetail', { code: p.code, items: p.itemCount, cost: p.totalCost.toLocaleString() })}>
                <div className="pkg-row flex items-center justify-between px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-6 shrink-0 text-[10px] font-semibold text-amber-600/80 dark:text-amber-400/70">
                      {p.code.replace('WP-', '')}
                    </span>
                    <span className="truncate text-[13px] text-zinc-800 dark:text-zinc-200">
                      {ar ? p.nameAr : p.nameEn}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 ps-2">
                    <span className="text-[10px] text-zinc-400">{p.itemCount}</span>
                    <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{compact(p.totalCost, i18n.language)}</span>
                  </div>
                </div>
              </Tooltip.Floating>
            ))}
          </AnimatedList>
        </ScrollArea>
      </div>

      <div className="flex items-baseline justify-between px-1">
        <Text size="xs" c="dimmed">
          {t('summaryLine', { items: data.inspection.items.length, packages: data.packages.length })}
        </Text>
        <div className="flex items-baseline gap-1.5">
          <Text size="xs" c="dimmed">EGP</Text>
          <NumberTicker value={grand} className="text-[17px] font-bold text-zinc-900 dark:text-white" />
        </div>
      </div>

      {errors.map((i) => (
        <Text key={i.code} size="xs" c="red" lh={1.3}>● {ar ? i.messageAr : i.messageEn}</Text>
      ))}
      {warnings.slice(0, 3).map((i) => (
        <Text key={i.code} size="xs" c="yellow.7" lh={1.3}>● {ar ? i.messageAr : i.messageEn}</Text>
      ))}
      {warnings.length > 3 && (
        <Text size="xs" c="dimmed">{t('moreIssues', { count: warnings.length - 3 })}</Text>
      )}

      <Group justify="space-between" mt={2}>
        <Button variant="subtle" size="xs" color="gray" onClick={onReset}>← {t('newFile')}</Button>
        <ShimmerButton disabled={busy || hasErrors} onClick={onGenerate} className="px-5 py-2 text-[13px]">
          {busy ? t('generatingShort') : t('generateOpenBtn')}
        </ShimmerButton>
      </Group>
    </div>
  );
}
