import { motion, useReducedMotion } from 'motion/react';

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
      <motion.div
        className="relative text-zinc-950 dark:text-white"
        style={{ width: config.box, height: config.box }}
        animate={reduceMotion ? undefined : { scale: [1, 1.025, 1] }}
        transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3].map((ring) => (
          <motion.span
            key={ring}
            className="absolute rounded-full"
            style={{
              inset: ring * 8,
              background: `conic-gradient(from ${ring * 55}deg, currentColor 0deg, currentColor ${64 - ring * 7}deg, transparent ${98 - ring * 5}deg, transparent 360deg)`,
              mask: `radial-gradient(farthest-side, transparent calc(100% - ${config.ring}px), #000 calc(100% - ${config.ring - 0.5}px))`,
              WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${config.ring}px), #000 calc(100% - ${config.ring - 0.5}px))`,
              opacity: 0.95 - ring * 0.16,
            }}
            animate={reduceMotion ? undefined : { rotate: ring % 2 ? -360 : 360 }}
            transition={{
              duration: 2.8 + ring * 0.8,
              ease: 'linear',
              repeat: Infinity,
            }}
          />
        ))}
        <span className="absolute inset-[42%] rounded-full bg-amber-500" />
      </motion.div>

      <h2 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-zinc-950 dark:text-white">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 max-w-md text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {subtitle}
        </p>
      )}
      {boundedProgress !== null && (
        <div className="mt-4 w-52">
          <div className="h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-amber-500"
              initial={false}
              animate={{ width: `${boundedProgress}%` }}
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
            />
          </div>
          <div className="mt-1.5 text-[11px] tabular-nums text-zinc-500">
            {boundedProgress}%
          </div>
        </div>
      )}
    </div>
  );
}
