// @vitest-environment jsdom
//
// Slice-0 spike: Spectrum UI components render in isolation (LTR + RTL) without
// touching the app shell. Fails if the Radix/cva wiring or the token bridge in
// index.css regresses.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Button } from '../src/components/ui/button';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from '../src/components/spectrumui/responsive-modal-dependencies';

function SpikeDialog() {
  return (
    <ResponsiveModal>
      <ResponsiveModalTrigger asChild>
        <Button variant="outline">Open</Button>
      </ResponsiveModalTrigger>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Spike title</ResponsiveModalTitle>
          <ResponsiveModalDescription>Spike body</ResponsiveModalDescription>
        </ResponsiveModalHeader>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

describe('spectrum spike', () => {
  afterEach(cleanup);

  it('renders the shadcn button with its variant class', () => {
    render(<Button variant="outline">Open</Button>);
    const button = screen.getByRole('button', { name: 'Open' });
    expect(button.className).toContain('border-input');
  });

  it('opens the responsive modal from its trigger', () => {
    render(<SpikeDialog />);
    expect(screen.queryByText('Spike title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Spike title')).not.toBeNull();
    expect(screen.getByText('Spike body')).not.toBeNull();
  });

  it('renders inside an RTL subtree', () => {
    render(
      <div dir="rtl">
        <SpikeDialog />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Spike title')).not.toBeNull();
  });
});
