// Ported from kokonutui AITextLoading (MIT, @kokonutui) — cycling shimmer text.
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

export default function AITextLoading({ texts, interval = 1400 }: { texts: string[]; interval?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % texts.length), interval);
    return () => clearInterval(timer);
  }, [interval, texts.length]);

  return (
    <div className="flex items-center justify-center py-2">
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="shimmer-text text-xl font-semibold tracking-tight"
        >
          {texts[index]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
