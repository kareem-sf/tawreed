import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { WorkPackage } from '../../../shared/types';

interface Props {
  packages: WorkPackage[];
  totalItems: number;
  locale: string;
  flaggedCodes: Set<string>;
  currencyLabel: string;
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
  currencyLabel,
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
    <ul className="m-0 list-none space-y-1 p-1.5">
      {packages.map((workPackage) => {
        const share = totalItems ? workPackage.itemCount / totalItems : 0;
        const flagged = flaggedCodes.has(workPackage.code);
        return (
          <li key={workPackage.code}>
            <button
              type="button"
              className="group w-full rounded-xl border border-transparent bg-transparent px-3 py-3 text-start text-inherit transition-[background-color,border-color,transform] duration-150 hover:border-zinc-200 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 active:scale-[0.998] dark:hover:border-white/10 dark:hover:bg-white/[0.045]"
              onClick={() => onSelect(workPackage)}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${workPackage.code === 'WP-99' ? 'bg-red-500' : 'bg-amber-500'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {packageName(workPackage)}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span className="font-mono">{workPackage.code}</span>
                        <span>{itemCountLabel(workPackage.itemCount)}</span>
                        <span>{percentage.format(share)}</span>
                        {flagged && (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                            <AlertTriangle size={10} aria-hidden="true" /> {needsReviewLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-end text-[12px] font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                        {currencyLabel} {compactNumber.format(workPackage.totalCost)}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3 text-zinc-400 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                      />
                    </div>
                  </div>
                  <div
                    className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.07]"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={totalItems}
                    aria-valuenow={workPackage.itemCount}
                    aria-label={`${packageName(workPackage)}: ${itemCountLabel(workPackage.itemCount)}`}
                  >
                    <div
                      className={`h-full rounded-full ${workPackage.code === 'WP-99' ? 'bg-red-500' : 'bg-amber-500'}`}
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
