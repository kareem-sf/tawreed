import { motion, useReducedMotion } from 'motion/react';
import { Progress } from './ui/progress';

interface WorkLoaderProps {
  title: string;
  subtitle?: string;
  progress?: number | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: { box: 58, ring: 3 },
  md: { box: 76, ring: 3 },
  lg: { box: 96, ring: 4 },
};

export default function WorkLoader({
  title,
  subtitle,
  progress = null,
  size = 'lg',
}: WorkLoaderProps) {
  const reduceMotion = useReducedMotion();
  const config = sizes[size];
  const boundedProgress = progress === null
    ? null
    : Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
      {/* Quiet arc for all waits: signals "working", not content. */}
      <div
        className="relative text-primary"
        style={{ width: config.box, height: config.box }}
        aria-hidden="true"
      >
      <span
        className="absolute inset-0 rounded-full"
        style={{ border: `${config.ring}px solid var(--border)` }}
      />
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{
          background: 'conic-gradient(from 0deg, currentColor 0deg, currentColor 80deg, transparent 140deg, transparent 360deg)',
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${config.ring}px), #000 calc(100% - ${config.ring - 0.5}px))`,
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${config.ring}px), #000 calc(100% - ${config.ring - 0.5}px))`,
        }}
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 1.4, ease: 'linear', repeat: Infinity }}
      />
      </div>

      <h2 className="mt-5 text-lg font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          {subtitle}
        </p>
      )}
      {boundedProgress !== null && (
        <div className="mt-4 w-52">
          <Progress value={boundedProgress} aria-label={`${boundedProgress}%`} />
          <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
            {boundedProgress}%
          </div>
        </div>
      )}
    </div>
  );
}
