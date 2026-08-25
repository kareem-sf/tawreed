import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeBootstrapStatus } from '../shared/platform';
import { BootstrapScreen } from '../src/features/bootstrap/BootstrapScreen';
import '../src/i18n';

function renderStatus(status: RuntimeBootstrapStatus): string {
  return renderToStaticMarkup(createElement(BootstrapScreen, {
    status,
    onRetry: () => undefined,
  }));
}

describe('bootstrap screen accessibility markup', () => {
  it('keeps active progress busy while placing the live status outside the busy subtree', () => {
    const markup = renderStatus({
      phase: 'downloading', progress: 42, component: 'agent-kernel', version: '1.0.0',
      errorCode: null, recoverable: false,
    });

    expect(markup).toMatch(/<section[^>]*aria-busy="true"/);
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="42"');
    expect(markup).toContain('role="status"');
    expect(markup.indexOf('</section>')).toBeLessThan(markup.indexOf('role="status"'));
  });

  it('marks terminal error content not busy and keeps its polite status immediately announceable', () => {
    const markup = renderStatus({
      phase: 'error', progress: null, component: null, version: null,
      errorCode: 'runtime_download_failed', recoverable: true,
    });

    expect(markup).toMatch(/<section[^>]*aria-busy="false"/);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup.indexOf('</section>')).toBeLessThan(markup.indexOf('role="status"'));
    expect(markup).toContain('>Retry</button>');
    expect(markup).not.toContain('aria-valuenow="0"');
  });
});
