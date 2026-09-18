import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { WorkPackage } from '../../../shared/types';
import { Badge } from '../../components/ui/badge';

interface Props {
  packages: WorkPackage[];
  totalItems: number;
  locale: string;
  flaggedCodes: Set<string>;
  needsReviewLabel: string;
  itemCountLabel: (count: number) => string;
  packageName: (workPackage: WorkPackage) => string;
  onSelect: (workPackage: WorkPackage) => void;
}

export function PackageSummaryList({
  packages,
  totalItems,
  locale,
  flaggedCodes,
  needsReviewLabel,
  itemCountLabel,
  packageName,
  onSelect,
}: Props) {
  const compactNumber = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: 'compact',
  });
  const percentage = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  return (
    <ul className="m-0 list-none p-0">
      {packages.map((workPackage) => {
        const share = totalItems ? workPackage.itemCount / totalItems : 0;
        const flagged = flaggedCodes.has(workPackage.code);
        return (
          <li key={workPackage.code} className="border-b border last:border-b-0">
            <button
              type="button"
              className="group w-full bg-transparent px-5 py-3.5 text-start text-inherit hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[flagged]:bg-[linear-gradient(90deg,rgba(226,116,90,0.08),transparent_60%)]"
              aria-flagged={flagged ? 'true' : undefined}
              onClick={() => onSelect(workPackage)}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-foreground">
                        {packageName(workPackage)}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="font-mono-figures">{workPackage.code}</span>
                        <span className="text-muted-foreground">{itemCountLabel(workPackage.itemCount)}</span>
                        <span className="tabular-nums">{percentage.format(share)}</span>
                        {flagged && (
                          <Badge variant="outline" className="border-destructive/30 text-destructive">
                            <AlertTriangle size={10} aria-hidden="true" /> {needsReviewLabel}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono-figures text-end text-[13.5px] font-semibold text-foreground">
                        {compactNumber.format(workPackage.totalCost)}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3 text-muted-foreground rtl:rotate-180"
                      />
                    </div>
                  </div>
                  <div
                    className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={totalItems}
                    aria-valuenow={workPackage.itemCount}
                    aria-label={`${packageName(workPackage)}: ${itemCountLabel(workPackage.itemCount)}`}
                  >
                    <div
                      className={`h-full rounded-full ${workPackage.code === 'WP-99' ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
