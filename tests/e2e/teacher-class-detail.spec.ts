import { test, expect } from '@playwright/test';
import { loginAsTeacher } from './helpers';

test.describe('Teacher class detail page', () => {
  let className: string;

  test('shows class info and supports student preview', async ({ page }) => {
    await loginAsTeacher(page);

    // Navigate to create class page
    await page.getByRole('link', { name: 'Create class' }).first().click();
    await expect(page).toHaveURL(/\/classes\/new/);
    await expect(page.locator('input[name="title"]')).toBeVisible();

    // Create a new class with identifiable name
    className = `E2E-detail-${Date.now()}`;
    await page.fill('input[name="title"]', className);
    await page.fill('input[name="subject"]', 'Calculus');
    await page.fill('input[name="level"]', 'College');
    await page.getByRole('button', { name: 'Create class' }).click();

    // Wait for redirect to detail page
    await expect(page).toHaveURL(/\/classes\/[a-f0-9-]+/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/classes\/new/);

    // Verify class title is visible
    const heading = page.locator('.editorial-title', { hasText: className }).first();
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Verify subject and level metadata
    await expect(page.getByText('Calculus')).toBeVisible();
    await expect(page.getByText('College')).toBeVisible();

    // Verify "Preview as student" button exists
    const previewLink = page.getByRole('link', { name: 'Preview as student' });
    await expect(previewLink).toBeVisible();

    // Navigate to student preview
    await previewLink.click();
    await expect(page).toHaveURL(/as=student/, { timeout: 10_000 });
  });
});
