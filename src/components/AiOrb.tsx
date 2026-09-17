import { useReducedMotion } from 'motion/react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { useColorScheme } from '../app/useColorScheme';

interface AiOrbProps {
  state?: OrbState;
  size?: 64 | 20;
}

/** AI thinking indicator. Theme follows the app scheme explicitly — the orb's
 * `auto` mode watches for Tailwind conventions our `data-mantine-color-scheme`
 * attribute does not match. Frozen under reduced-motion; decorative (the
 * surrounding live region carries the announcement). */
export function AiOrb({ state = 'working', size = 64 }: AiOrbProps) {
  const { resolved } = useColorScheme();
  const reduceMotion = useReducedMotion();
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme={resolved}
      paused={reduceMotion ?? false}
      aria-hidden="true"
    />
  );
}
