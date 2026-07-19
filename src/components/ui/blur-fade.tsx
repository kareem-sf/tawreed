// Ported from Magic UI (MIT, magicui.design) — blur+fade+y entrance, transitions only.
import { motion, type Variants } from 'motion/react';
import { cn } from '../../lib/utils';

interface BlurFadeProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  yOffset?: number;
  blur?: string;
}

export function BlurFade({ children, className, delay = 0, yOffset = 8, blur = '6px' }: BlurFadeProps) {
  const variants: Variants = {
    hidden: { opacity: 0, filter: `blur(${blur})`, y: yOffset },
    visible: { opacity: 1, filter: 'blur(0px)', y: 0 },
  };
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={variants}
      transition={{ duration: 0.3, delay, ease: [0.22, 0.61, 0.36, 1] }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
