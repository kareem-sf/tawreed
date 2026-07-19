import { useId } from 'react';

// A BOQ-to-packages monogram: one strong source beam, a central T, and two routed outputs.
export default function Logo({ size = 20, className = '' }: { size?: number; className?: string }) {
  const gradientId = useId().replaceAll(':', '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Tawreed"
    >
      <defs>
        <linearGradient id={gradientId} x1="5" y1="4" x2="25" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD977" />
          <stop offset="0.52" stopColor="#E9AD38" />
          <stop offset="1" stopColor="#C98618" />
        </linearGradient>
      </defs>
      <path
        d="M5.1 4.5H28L24.7 10.7H18.5V27.4L14.2 24.9V10.7H7.2L3.7 7.4L5.1 4.5Z"
        fill={`url(#${gradientId})`}
      />
      <path d="M18.5 14H25.1L22.8 18.3H18.5V14Z" fill={`url(#${gradientId})`} opacity="0.78" />
      <path d="M18.5 20.6H22L19.9 24.7H18.5V20.6Z" fill={`url(#${gradientId})`} opacity="0.52" />
    </svg>
  );
}
