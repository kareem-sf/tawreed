// Ported from Magic UI (MIT, magicui.design) — static SVG dot background (zero cost).
import { useId } from 'react';
import { cn } from '../../lib/utils';

interface DotPatternProps {
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  cr?: number;
  className?: string;
}

export function DotPattern({ width = 18, height = 18, cx = 1, cy = 1, cr = 1, className }: DotPatternProps) {
  // Strip colons — they are flaky inside SVG url(#…) references on WebKit.
  const id = useId().replaceAll(':', '');
  return (
    <svg aria-hidden="true" className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}>
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse">
          <circle cx={cx} cy={cy} r={cr} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
