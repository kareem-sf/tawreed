// Ported from Magic UI (MIT, magicui.design) — staggered children entrance.
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

interface AnimatedListProps {
  children: React.ReactNode[];
  className?: string;
  stagger?: number;
}

export function AnimatedList({ children, className, stagger = 0.05 }: AnimatedListProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      {children.map((child, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -12, filter: 'blur(4px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.3, delay: i * stagger, ease: 'easeOut' }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}
