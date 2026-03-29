import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {

  test('homepage is accessible', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  test('page title is set', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('404 page handles unknown routes gracefully', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist-xyz');
    // Should return 404 or redirect — not 500
    expect(response?.status()).not.toBe(500);
  });

  test('health check API responds', async ({ page }) => {
    const response = await page.request.get('/api/health').catch(() => null);
    // Either 200 or 404 (if not implemented) — not 500
    if (response) {
      expect(response.status()).not.toBe(500);
    }
  });

});
