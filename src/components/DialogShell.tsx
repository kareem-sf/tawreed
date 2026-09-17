import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import {
  ResponsiveModal,
  ResponsiveModalOverlay,
  ResponsiveModalTitle,
} from './spectrumui/responsive-modal-dependencies';

interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  /** Shell title. Omit when the body owns its heading (it must then render
   * a DialogPrimitive.Title itself so the dialog stays labelled). */
  title?: ReactNode;
  /** Translated accessible label for the close button. Omit when the body
   * owns its close control (e.g. About) or must not close implicitly. */
  closeLabel?: string;
  side?: 'center' | 'left' | 'right';
  contentClassName?: string;
  children: ReactNode;
}

const CENTER_PANEL =
  'left-1/2 top-1/2 max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-ledger-line p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95';

const SHEET_PANEL =
  'inset-y-0 flex h-full w-[min(560px,92vw)] flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-200';

const SHEET_SIDES = {
  left: 'left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
  right: 'right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
} as const;

/** Shared dialog frame for app-level overlays: settings/about modals and the
 * history sheet. Centered panels zoom-fade; side sheets slide. Dismissal
 * (ESC/backdrop/X) always funnels through onClose. */
export function DialogShell({
  open,
  onClose,
  title,
  closeLabel,
  side = 'center',
  contentClassName,
  children,
}: DialogShellProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ResponsiveModalOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 bg-background shadow-lg',
          side === 'center' ? CENTER_PANEL : SHEET_PANEL,
          side !== 'center' && SHEET_SIDES[side],
          contentClassName,
        )}
      >
        {(title || closeLabel) && (
          <div className={cn('flex items-start justify-between gap-4', side !== 'center' && 'px-5 pt-5')}>
            {title
              ? <ResponsiveModalTitle className="text-[15px] font-semibold">{title}</ResponsiveModalTitle>
              : <span />}
            {closeLabel && (
              <DialogPrimitive.Close
                aria-label={closeLabel}
                className="shrink-0 rounded-md p-1.5 text-ledger-ink-faint transition hover:bg-ledger-surface-2 hover:text-ledger-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X size={15} aria-hidden="true" />
              </DialogPrimitive.Close>
            )}
          </div>
        )}
        {side === 'center'
          ? (title || closeLabel ? <div className="mt-2">{children}</div> : <>{children}</>)
          : <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>}
      </DialogPrimitive.Content>
    </ResponsiveModal>
  );
}
