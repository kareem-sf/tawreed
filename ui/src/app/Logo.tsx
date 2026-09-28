// Tawreed's mark: ت (taa), the first letter of توريد, in Thmanyah Serif Display Bold, outlined (the masters are in
// brand/logo; only outlines ship, never the font). The bowl is the letter; its two diamond dots are two packages.
// Monochrome by default: it takes the surrounding text colour, so it follows light, dark and Arabic. "brand" paints
// the bowl gold and the dots ivory, for dark backgrounds only. `size` is the height; the width follows the letter.
const WIDTH = 787;
const HEIGHT = 629;

export function Logo({ size = 20, tone = "mono" }: { size?: number; tone?: "mono" | "brand" }) {
  const brand = tone === "brand";
  return (
    <svg
      width={(size * WIDTH) / HEIGHT}
      height={size}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      fill="none"
      aria-hidden="true"
      data-testid="logo"
    >
      <path
        d="M681 129H665L604 271C641 307 692 363 717 407C642 422 465 445 319 445C141 445 62 411 62 275C62 252 65 221 69 187H51C29 264 20 327 20 382C20 553 115 609 284 609C422 609 596 571 678 552L728 416C742 379 748 342 746 305L767 255Z"
        fill={brand ? "#E9AD38" : "currentColor"}
      />
      <path
        d="M505 111C506 111 506 99 505 98L427 20L357 90L287 20L208 99V110L287 190L357 120L427 190Z"
        fill={brand ? "#F3EFE6" : "currentColor"}
      />
    </svg>
  );
}
