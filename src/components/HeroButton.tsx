import { useReducedMotion } from 'motion/react';
import { MetalFx } from 'metal-fx';
import { useColorScheme } from '../app/useColorScheme';
import { Button, type ButtonProps } from './ui/button';

/** The single hero action per screen, wrapped in a quiet liquid-gold finish.
 * WebGL2 only — without it (or under reduced-motion) the plain button shows.
 * Strength stays low: presence, not spectacle. */
export function HeroButton({ children, disabled, ...props }: ButtonProps) {
  const { resolved } = useColorScheme();
  const reduceMotion = useReducedMotion();
  return (
    <MetalFx preset="gold" strength={0.6} theme={resolved} paused={(reduceMotion ?? false) || disabled}>
      <Button variant="default" disabled={disabled} {...props}>
        {children}
      </Button>
    </MetalFx>
  );
}
