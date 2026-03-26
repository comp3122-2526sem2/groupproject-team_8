import { BASE_URL, TEACHER_EMAIL, TEACHER_PASSWORD } from '../config';
import { test, expect } from '@playwright/test';

test('Teacher dashboard navigation', async ({ page }) => {
  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', TEACHER_EMAIL);
  await page.fill('input[name="password"]', TEACHER_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for dashboard
  await expect(page).toHaveURL(/teacher\/dashboard/);
  await page.screenshot({ path: 'tests/results/debug-dashboard.png' });

  // Sidebar navigation tests
  await page.click('nav >> text=My Classes');
  await expect(page).toHaveURL(/teacher\/classes/);

  await page.click('nav >> text=Dashboard');
  await expect(page).toHaveURL(/teacher\/dashboard/);

  await page.click('nav >> text=Settings');
  await expect(page).toHaveURL(/settings/);

  await page.click('nav >> text=Help');
  await expect(page).toHaveURL(/help/);
});
