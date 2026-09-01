import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Smoke test for the real app in browser-dev mode: uploading a BOQ takes the
// user from the idle drop screen through parsing/classification to a review
// screen listing the extracted items. Publishing (which needs the Tauri
// desktop bridge) is out of scope here — see docs on desktop-only commands.
const fixture = fileURLToPath(new URL('../fixtures/browser-sample-boq.csv', import.meta.url));

test('uploading a BOQ reaches the review screen with extracted items', async ({ page }) => {
  await page.goto('/');

  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles(fixture);

  await expect(page.getByText(/review/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('3 items → 3 packages')).toBeVisible();
  await expect(page.getByRole('button', { name: /Earthworks.*WP-01/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Concrete.*WP-02/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Electrical.*WP-09/ })).toBeVisible();
});
