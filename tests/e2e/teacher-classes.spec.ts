import { test, expect } from '@playwright/test';
import { loginAsTeacher } from './helpers';

test.describe('Teacher class creation', () => {
  test('creates a class from the dashboard and lands on the detail page', async ({ page }) => {
    await loginAsTeacher(page);

    // Click "Create class" link (header or Quick Actions)
    await page.getByRole('link', { name: 'Create class' }).first().click();
    await expect(page).toHaveURL(/\/classes\/new/);

    // Fill in class details
    const className = `E2E-class-${Date.now()}`;
    await page.fill('input[name="title"]', className);
    await page.fill('input[name="subject"]', 'Mathematics');
    await page.fill('input[name="level"]', 'College');

    // Submit the form
    await page.getByRole('button', { name: 'Create class' }).click();

    // Wait for redirect to the new class detail page
    await expect(page).toHaveURL(/\/classes\/[a-f0-9-]+/, { timeout: 20_000 });
    // Should NOT still be on /classes/new
    await expect(page).not.toHaveURL(/\/classes\/new/);

    // Verify the class title appears on the detail page
    const heading = page.locator('.editorial-title', { hasText: className }).first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });
});
