// A BOQ-to-packages monogram: one strong source beam, a central T, and two
// routed outputs. Monochrome by design — inherits surrounding text color
// (currentColor) so it follows the theme instead of carrying brand paint.
export default function Logo({ size = 20, className = '' }: { size?: number; className?: string }) {
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
      <path
        d="M5.1 4.5H28L24.7 10.7H18.5V27.4L14.2 24.9V10.7H7.2L3.7 7.4L5.1 4.5Z"
        fill="currentColor"
      />
      <path d="M18.5 14H25.1L22.8 18.3H18.5V14Z" fill="currentColor" opacity="0.78" />
      <path d="M18.5 20.6H22L19.9 24.7H18.5V20.6Z" fill="currentColor" opacity="0.52" />
    </svg>
  );
}
