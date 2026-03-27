import { test, expect } from '@playwright/test';
import { loginAsTeacher } from './helpers';

test.describe('Teacher sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTeacher(page);
  });

  test('navigates to My Classes', async ({ page }) => {
    await page.getByRole('link', { name: 'My Classes' }).click();
    await expect(page).toHaveURL(/teacher\/classes/);
  });

  test('navigates to Dashboard', async ({ page }) => {
    // First leave the dashboard, then navigate back
    await page.getByRole('link', { name: 'My Classes' }).click();
    await expect(page).toHaveURL(/teacher\/classes/);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/teacher\/dashboard/);
  });

  test('navigates to Settings', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/settings/);
  });

  test('navigates to Help', async ({ page }) => {
    await page.getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL(/help/);
  });
});
