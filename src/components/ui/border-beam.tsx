// Ported from Magic UI (MIT, magicui.design) — beam of light traveling the border.
// Mounted only during drag-over in Tawreed (zero cost when idle).
import { motion, type MotionStyle, type Transition } from 'motion/react';
import { cn } from '../../lib/utils';

interface BorderBeamProps {
  size?: number;
  duration?: number;
  colorFrom?: string;
  colorTo?: string;
  transition?: Transition;
  className?: string;
  borderWidth?: number;
}

export const BorderBeam = ({
  className,
  size = 60,
  duration = 4,
  colorFrom = '#E8B54A',
  colorTo = '#F5D58A',
  transition,
  borderWidth = 1.5,
}: BorderBeamProps) => (
  <div
    className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
    style={{ '--border-beam-width': `${borderWidth}px` } as React.CSSProperties}
  >
    <motion.div
      className={cn('absolute aspect-square', 'bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent', className)}
      style={
        {
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
        } as MotionStyle
      }
      initial={{ offsetDistance: '0%' }}
      animate={{ offsetDistance: ['0%', '100%'] }}
      transition={{ repeat: Infinity, ease: 'linear', duration, ...transition }}
    />
  </div>
);
