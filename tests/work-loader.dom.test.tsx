// @vitest-environment jsdom
//
// WorkLoader contract: role=status live region, title/subtitle copy, and a
// clamped 0–100 progress readout. The visual ring treatment may be restyled
// freely; these assertions pin the behavior the redesign must preserve.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import WorkLoader from '../src/components/WorkLoader';

describe('WorkLoader', () => {
  afterEach(cleanup);

  it('announces itself as a polite live region with the title', () => {
    render(<WorkLoader title="Working" />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Working');
  });

  it('shows the subtitle when provided and omits it otherwise', () => {
    const { unmount } = render(<WorkLoader title="Working" subtitle="Almost there" />);
    expect(screen.getByText('Almost there')).not.toBeNull();
    unmount();
    render(<WorkLoader title="Working" />);
    expect(screen.queryByText('Almost there')).toBeNull();
  });

  it('clamps progress into 0–100 and renders the percent', () => {
    const { unmount } = render(<WorkLoader title="Working" progress={150} />);
    expect(screen.getByText('100%')).not.toBeNull();
    unmount();
    render(<WorkLoader title="Working" progress={-20} />);
    expect(screen.getByText('0%')).not.toBeNull();
  });

  it('renders no progress readout when progress is null', () => {
    render(<WorkLoader title="Working" progress={null} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('renders the thinking orb instead of the arc when orbState is set', () => {
    const { container } = render(<WorkLoader title="Working" orbState="working" />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
  });
});
