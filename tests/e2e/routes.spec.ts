import { expect, test } from '@playwright/test';

test('login route renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('body')).toContainText('Log in');
});
