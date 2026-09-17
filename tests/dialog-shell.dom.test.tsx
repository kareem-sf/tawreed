// @vitest-environment jsdom
//
// Slice-5 guard: the shared dialog frame renders titled content and funnels
// every dismissal path (X, ESC) through onClose.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DialogShell } from '../src/components/DialogShell';

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.scrollTo ??= (() => {}) as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

function renderShell(open: boolean, onClose: () => void) {
  return render(
    <DialogShell open={open} onClose={onClose} title="Settings" closeLabel="Close">
      <p>Shell body</p>
    </DialogShell>,
  );
}

describe('DialogShell', () => {
  it('renders nothing when closed and titled content when open', () => {
    renderShell(false, () => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    renderShell(true, () => undefined);
    expect(screen.getByRole('dialog').textContent).toContain('Settings');
    expect(screen.getByText('Shell body')).not.toBeNull();
  });

  it('closes through the close button and through ESC', () => {
    const seen: number[] = [];
    renderShell(true, () => seen.push(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(seen).toHaveLength(1);
    cleanup();
    renderShell(true, () => seen.push(1));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(seen).toHaveLength(2);
  });
});
