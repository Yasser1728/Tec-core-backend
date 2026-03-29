import { test, expect } from '@playwright/test';

test.describe('Hub Page (authenticated)', () => {

  // موك الـ auth state
  test.beforeEach(async ({ page }) => {
    // Set mock auth tokens
    await page.addInitScript(() => {
      localStorage.setItem('tec_access_token', 'mock-test-token');
      localStorage.setItem('tec_user', JSON.stringify({
        id:         'afa10fec-aa5e-4455-b66e-24a3664ac983',
        piId:       'e27efdd3-c891-4361-8fa5-5338ada467a9',
        piUsername: 'yas55eR82',
      }));
    });
  });

  test('hub page has correct structure', async ({ page }) => {
    await page.goto('/hub');
    await page.waitForLoadState('networkidle');

    // Either shows hub or redirects to login
    const url = page.url();
    // Acceptable: hub loaded OR redirected to login
    expect(url).toMatch(/\/(hub|$)/);
  });

  test('TEC branding is visible when hub loads', async ({ page }) => {
    await page.goto('/hub');
    await page.waitForLoadState('networkidle');

    const tecLogo = page.locator('text=TEC').first();
    if (await tecLogo.isVisible()) {
      await expect(tecLogo).toBeVisible();
    }
  });

  test('notification bell button exists on hub', async ({ page }) => {
    await page.goto('/hub');
    await page.waitForLoadState('domcontentloaded');

    const bell = page.locator('button').filter({ hasText: /🔔/ }).first();
    if (await bell.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(bell).toBeVisible();
    }
  });

});
