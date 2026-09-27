import { expect, test } from '@playwright/test';

// Throwaway probe: open Settings, dump computed tab styles + screenshot.
test('settings tabs computed styles', async ({ page }) => {
  await page.goto('/');

  // Open settings via the TitleBar button (aria-label comes from settingsLabel key).
  const settingsBtn = page.getByRole('button', { name: /settings|الإعدادات/i });
  await expect(settingsBtn.first()).toBeVisible({ timeout: 15000 });
  await settingsBtn.first().click();

  const generalTab = page.getByRole('tab', { name: 'General' });
  await expect(generalTab).toBeVisible({ timeout: 10000 });

  const dump = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    const lists = Array.from(document.querySelectorAll('[role="tablist"]'));
    out.tablistCount = lists.length;
    out.tablists = lists.map((el) => ({
      cls: (el as HTMLElement).className,
      bg: getComputedStyle(el as HTMLElement).backgroundColor,
      borderBottom: getComputedStyle(el as HTMLElement).borderBottom,
    }));
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    out.tabCount = tabs.length;
    out.tabs = tabs.map((el) => ({
      name: (el as HTMLElement).textContent?.trim(),
      cls: (el as HTMLElement).className,
      bg: getComputedStyle(el as HTMLElement).backgroundColor,
      boxShadow: getComputedStyle(el as HTMLElement).boxShadow,
    }));
    const btns = Array.from(document.querySelectorAll('button'));
    out.buttonCount = btns.length;
    return out;
  });
  console.log('PROBE_DUMP::' + JSON.stringify(dump, null, 1).slice(0, 4000));
  await page.screenshot({ path: 'test-results/zz-tabs-probe.png' });
});
