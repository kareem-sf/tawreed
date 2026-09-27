// @vitest-environment jsdom
//
// New-primitives guard: kbd/badge/empty/progress/item/input-group render
// with their accessible contracts, and AlertDialog reports explicit
// choice (confirm vs cancel) instead of closing implicitly.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { Kbd } from '../src/components/ui/kbd';
import { Badge } from '../src/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../src/components/ui/empty';
import { Progress } from '../src/components/ui/progress';
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '../src/components/ui/item';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../src/components/ui/input-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../src/components/ui/alert-dialog';
import { buttonVariants } from '../src/components/ui/button';
import { TooltipProvider } from '../src/components/ui/tooltip';

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
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  return i18n.changeLanguage('en');
});

afterEach(cleanup);

function renderWithI18n(element: React.ReactElement) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{element}</TooltipProvider>
    </I18nextProvider>,
  );
}

describe('new primitives', () => {
  it('Kbd renders the shortcut label', () => {
    renderWithI18n(<Kbd>Alt+H</Kbd>);
    expect(screen.getByText('Alt+H').tagName).toBe('KBD');
  });

  it('Badge renders status text', () => {
    renderWithI18n(<Badge>Needs review</Badge>);
    expect(screen.getByText('Needs review')).not.toBeNull();
  });

  it('Empty renders title and description', () => {
    renderWithI18n(
      <Empty>
        <EmptyHeader>
          <EmptyMedia>icon</EmptyMedia>
          <EmptyTitle>No runs yet</EmptyTitle>
          <EmptyDescription>Nothing here</EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
    expect(screen.getByText('No runs yet')).not.toBeNull();
    expect(screen.getByText('Nothing here')).not.toBeNull();
  });

  it('Progress exposes clamped value as a progressbar', () => {
    renderWithI18n(<Progress value={140} aria-label="progress" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('Item group renders rows with actions', () => {
    renderWithI18n(
      <ItemGroup>
        <Item>
          <ItemContent>
            <ItemTitle>Project A</ItemTitle>
          </ItemContent>
          <ItemActions>
            <button type="button" aria-label="Revoke: Project A">x</button>
          </ItemActions>
        </Item>
      </ItemGroup>,
    );
    expect(screen.getByText('Project A')).not.toBeNull();
    expect(screen.getByLabelText('Revoke: Project A')).not.toBeNull();
  });

  it('InputGroup keeps label association and toggle press state', () => {
    renderWithI18n(
      <InputGroup>
        <InputGroupInput id="key" aria-label="API key" type="password" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Show API key" aria-pressed={false}>
            eye
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByLabelText('API key')).not.toBeNull();
    expect(screen.getByLabelText('Show API key').getAttribute('aria-pressed')).toBe('false');
  });

  it('AlertDialog reports confirm and cancel separately', () => {
    let result: string | null = null;
    renderWithI18n(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { result = 'cancel'; }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => { result = 'confirm'; }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByText('Delete this project?')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(result).toBe('confirm');
  });

  it('AlertDialog cancel reports cancel', () => {
    let result: string | null = null;
    renderWithI18n(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove connection?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { result = 'cancel'; }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => { result = 'confirm'; }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(result).toBe('cancel');
  });
});
