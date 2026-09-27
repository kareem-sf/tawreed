// Tawreed's mark, kept from the previous app: one source beam, a central T, and two routed outputs.
// Monochrome: it takes the surrounding text colour, so it follows the theme. The gold version is the app icon.
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" data-testid="logo">
      <path d="M5.1 4.5H28L24.7 10.7H18.5V27.4L14.2 24.9V10.7H7.2L3.7 7.4L5.1 4.5Z" fill="currentColor" />
      <path d="M18.5 14H25.1L22.8 18.3H18.5V14Z" fill="currentColor" opacity="0.78" />
      <path d="M18.5 20.6H22L19.9 24.7H18.5V20.6Z" fill="currentColor" opacity="0.52" />
    </svg>
  );
}
