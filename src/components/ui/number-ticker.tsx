// Ported from Magic UI (MIT, magicui.design) — eased count-up on mount/change.
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface NumberTickerProps {
  value: number;
  duration?: number;
  className?: string;
  formatter?: (n: number) => string;
}

export function NumberTicker({ value, duration = 900, className, formatter }: NumberTickerProps) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const currentValue = from + (value - from) * eased;
      setDisplay(currentValue);
      fromRef.current = currentValue; // track live value each tick
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const fmt = formatter ?? ((n: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(n));
  return <span className={cn('tabular-nums', className)}>{fmt(display)}</span>;
}
