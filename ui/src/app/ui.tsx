import { useEffect, useState, type ReactNode } from "react";
import { money } from "./format";
import { useSettings } from "./settings";

/* Tawreed's few building blocks, so every screen draws a button, a field or a notice the same way.
   Each is a class string (Tailwind needs whole class names in the source) or a small component. */

type Kind = "primary" | "secondary" | "quiet" | "danger";
type Size = "md" | "sm";

// Labels wrap rather than overflow: a long label in a narrow window takes a second line, never a cut.
const BUTTON =
  "inline-flex max-w-full select-none items-center justify-center gap-1.5 rounded-lg border text-center transition-[color,background-color,border-color,transform] duration-150 ease-out [overflow-wrap:anywhere] active:translate-y-px disabled:pointer-events-none disabled:opacity-45";
const KINDS: Record<Kind, string> = {
  primary: "border-transparent bg-button text-button-ink hover:bg-button/85",
  secondary: "border-line-strong bg-page text-ink hover:border-ink/35 hover:bg-soft active:bg-subtle",
  quiet: "border-transparent text-ink-2 hover:bg-subtle hover:text-ink",
  danger: "border-line-strong bg-page text-danger hover:border-danger/40 hover:bg-danger/5",
};
const SIZES: Record<Size, string> = {
  md: "min-h-9 px-4 py-1.5 pointer-coarse:min-h-11",
  sm: "min-h-8 px-3 py-1 text-sm pointer-coarse:min-h-10",
};

/** A button's classes: primary (the one action that matters), secondary, quiet or danger; md or sm. */
export function button(kind: Kind = "secondary", size: Size = "md"): string {
  return `${BUTTON} ${KINDS[kind]} ${SIZES[size]}`;
}

/** A square button that holds only an icon. */
export function iconButton(size: Size = "md"): string {
  return `${BUTTON} shrink-0 ${KINDS.quiet} ${size === "md" ? "size-9 pointer-coarse:size-11" : "size-8 pointer-coarse:size-10"}`;
}

/** An action set as text: underlined, quiet until pointed at. */
export const link =
  "rounded-sm text-ink-2 underline decoration-ink-2/35 underline-offset-[3px] transition-colors duration-150 hover:text-ink hover:decoration-ink disabled:pointer-events-none disabled:opacity-45 pointer-coarse:py-2";

/** Text fields and selects: a visible edge, the shared focus ring, a calm hover. */
export const field =
  "h-9 rounded-lg border border-edge bg-page px-3 text-ink transition-colors duration-150 placeholder:text-ink-2/70 hover:border-ink/70 focus-visible:border-ink disabled:opacity-45 pointer-coarse:h-11";
export const fieldSmall =
  "h-8 rounded-md border border-edge bg-page px-2 text-sm text-ink transition-colors duration-150 hover:border-ink/70 focus-visible:border-ink pointer-coarse:h-10";
export const textArea =
  "min-h-[4.5rem] rounded-lg border border-edge bg-page px-3 py-2 text-ink transition-colors duration-150 placeholder:text-ink-2/70 hover:border-ink/70 focus-visible:border-ink";

/** A bordered surface that holds one thing: a decision, a published revision. */
export const card = "rounded-xl border border-line bg-page px-5 py-4 animate-enter";

/** A small rounded label: a count, a state. */
export const pill = "inline-flex h-6 shrink-0 items-center rounded-full border border-line px-2.5 text-sm text-ink-2";

/** The frame every screen sits in, so their edges line up with the header and with each other. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto flex w-full max-w-[880px] flex-col px-4 pt-6 pb-24 sm:px-6 ${className}`}>{children}</div>;
}

/** A screen's title. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="font-heading text-title font-light">{children}</h1>;
}

/** The small heading over a group of rows. */
export function SectionLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="pb-2 text-sm font-semibold text-ink-2">
      {children}
    </h2>
  );
}

/** Something went wrong: what, and, when it can be tried again, a way to. */
export function Alert({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  const { t } = useSettings();
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p role="alert" className="text-danger">
        {children}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={link}>
          {t("ui.retry")}
        </button>
      )}
    </div>
  );
}

/** A shape where content is about to be, so a screen doesn't jump when it arrives. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-subtle motion-reduce:animate-none ${className}`} />;
}

/** Rows that are about to arrive. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-t border-line-soft py-3">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Nothing here yet, and what would put something here. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-ink-2">{children}</p>;
}

type IconName = "close" | "back" | "next" | "layers" | "check" | "plus";
const PATHS: Record<IconName, ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
};

/** A line icon. Arrows turn round in right-to-left text. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const turns = name === "back" || name === "next";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={turns ? "shrink-0 rtl:-scale-x-100" : "shrink-0"}
    >
      {PATHS[name]}
    </svg>
  );
}

/** An amount Tawreed computed, grouped to read, always to the cent. */
export function Amount({ value }: { value: string }) {
  const { locale } = useSettings();
  return <>{money(value, locale)}</>;
}

const NARROW = "(max-width: 639px)";

/** Whether the window is narrow (a half-screen window, a small laptop): some lists then change their shape. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia(NARROW);
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return narrow;
}
