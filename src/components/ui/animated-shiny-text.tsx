// Ported from Magic UI (MIT, magicui.design) — shimmering gradient text (busy states only).
import { cn } from '../../lib/utils';

interface AnimatedShinyTextProps {
  children: React.ReactNode;
  className?: string;
  shimmerWidth?: number;
}

export function AnimatedShinyText({ children, className, shimmerWidth = 120 }: AnimatedShinyTextProps) {
  return (
    <span
      className={cn('shiny-text font-semibold tracking-tight', className)}
      style={{ '--shiny-width': `${shimmerWidth}px` } as React.CSSProperties}
    >
      {children}
    </span>
  );
}
