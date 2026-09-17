import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '../../lib/utils';

interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** Extra classes for the fill (e.g. danger tone for unclassified share). */
  indicatorClassName?: string;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, indicatorClassName, ...props }, ref) => {
  const bounded = value === undefined || value === null
    ? 0
    : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <ProgressPrimitive.Root
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={bounded}
      value={bounded}
      className={cn(
        'relative h-1 w-full overflow-hidden rounded-full bg-ledger-surface-2',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full w-full flex-1 rounded-full bg-gold transition-transform duration-300 ease-out motion-reduce:transition-none',
          indicatorClassName,
        )}
        style={{ transform: `translateX(-${100 - bounded}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
