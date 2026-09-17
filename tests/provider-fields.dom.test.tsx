// @vitest-environment jsdom
//
// Slice-2b guard: the replacement provider-field components preserve the
// Mantine behaviors they replace — label association, password toggle,
// searchable model select with the same value/onChange contract.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { Field } from '../src/features/settings/Field';
import { PasswordField } from '../src/features/settings/PasswordField';
import { ModelSelect } from '../src/features/settings/ModelSelect';
import { Input } from '../src/components/ui/input';

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
  return i18n.changeLanguage('en');
});

afterEach(cleanup);

function renderWithI18n(element: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}

describe('Field', () => {
  it('associates the label with its input and exposes the description', () => {
    renderWithI18n(
      <Field label="API key" description="Stored securely">
        {({ id, descriptionId }) => (
          <Input id={id} aria-describedby={descriptionId} />
        )}
      </Field>,
    );
    const input = screen.getByLabelText('API key');
    expect(input.getAttribute('aria-describedby')).not.toBeNull();
    const description = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('Stored securely');
  });
});

describe('PasswordField', () => {
  it('masks by default and toggles visibility with pressed state', () => {
    const { container } = renderWithI18n(
      <PasswordField id="key" value="secret" onChange={() => undefined} />,
    );
    const input = container.querySelector('input')!;
    expect(input.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show API key' });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hide API key' })).not.toBeNull();
  });
});

describe('ModelSelect', () => {
  const options = [
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'claude-opus', label: 'Claude Opus' },
  ];

  it('selects an option through the combobox and reports its value', () => {
    const seen: Array<string | null> = [];
    const view = renderWithI18n(
      <ModelSelect
        label="Model"
        placeholder="Pick a model"
        options={options}
        value={null}
        onChange={(value) => seen.push(value)}
      />,
    );
    expect(screen.getByText('Pick a model')).not.toBeNull();
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Claude Opus' }));
    expect(seen).toEqual(['claude-opus']);
    expect(screen.queryByRole('listbox')).toBeNull();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ModelSelect
          label="Model"
          placeholder="Pick a model"
          options={options}
          value="claude-opus"
          onChange={(value) => seen.push(value)}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole('combobox').textContent).toContain('Claude Opus');
  });

  it('filters options as the user types and names the empty state', () => {
    renderWithI18n(
      <ModelSelect
        label="Model"
        placeholder="Pick a model"
        options={options}
        value={null}
        onChange={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('combobox'));
    const search = screen.getByPlaceholderText('Pick a model');
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('No matching models')).not.toBeNull();
  });
});
