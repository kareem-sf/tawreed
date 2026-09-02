import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { WorkPackage } from '../../../shared/types';

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
          <li key={workPackage.code} className="border-b border-ledger-line last:border-b-0">
            <button
              type="button"
              className="group w-full bg-transparent px-5 py-3.5 text-start text-inherit transition-colors duration-150 hover:bg-gold/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep/70 aria-[flagged]:bg-[linear-gradient(90deg,rgba(226,116,90,0.08),transparent_60%)]"
              onClick={() => onSelect(workPackage)}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-ledger-ink">
                        {packageName(workPackage)}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ledger-ink-faint">
                        <span className="font-mono-figures">{workPackage.code}</span>
                        <span className="text-ledger-ink-dim">{itemCountLabel(workPackage.itemCount)}</span>
                        <span>{percentage.format(share)}</span>
                        {flagged && (
                          <span className="inline-flex items-center gap-1 font-medium text-ledger-danger">
                            <AlertTriangle size={10} aria-hidden="true" /> {needsReviewLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono-figures text-end text-[13.5px] font-semibold text-ledger-ink">
                        {compactNumber.format(workPackage.totalCost)}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3 text-ledger-ink-faint transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                      />
                    </div>
                  </div>
                  <div
                    className="mt-2 h-1 overflow-hidden rounded-full bg-ledger-surface-2"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={totalItems}
                    aria-valuenow={workPackage.itemCount}
                    aria-label={`${packageName(workPackage)}: ${itemCountLabel(workPackage.itemCount)}`}
                  >
                    <div
                      className={`h-full rounded-full ${workPackage.code === 'WP-99' ? 'bg-ledger-danger' : 'bg-gold'}`}
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
