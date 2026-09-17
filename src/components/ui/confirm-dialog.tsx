import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

import { Button } from './button';
import {
  ResponsiveModal,
  ResponsiveModalDescription,
  ResponsiveModalOverlay,
  ResponsiveModalTitle,
} from '../spectrumui/responsive-modal-dependencies';

/**
 * Explicit destructive confirm built on the app's ResponsiveModal frame —
 * deliberately NOT the canonical Base-UI alert-dialog (second headless lib).
 * Dismissal (ESC/backdrop/X) always cancels; focus lands on Cancel.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <ResponsiveModalOverlay />
      <DialogPrimitive.Content
        aria-busy={busy || undefined}
        className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-ledger-line bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <ResponsiveModalTitle className="font-serif-display text-[15px]">
          {title}
        </ResponsiveModalTitle>
        {description && (
          <ResponsiveModalDescription className="mt-1.5">
            {description}
          </ResponsiveModalDescription>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="sm" disabled={busy}>
              {cancelLabel}
            </Button>
          </DialogPrimitive.Close>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogPrimitive.Content>
    </ResponsiveModal>
  );
}
