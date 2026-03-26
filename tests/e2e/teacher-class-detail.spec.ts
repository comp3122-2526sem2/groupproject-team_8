import { BASE_URL, TEACHER_EMAIL, TEACHER_PASSWORD } from '../config';
import { test, expect } from '@playwright/test';

test('Teacher class detail page info and navigation', async ({ page }) => {
  // Login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', TEACHER_EMAIL);
  await page.fill('input[name="password"]', TEACHER_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/teacher\/dashboard/);

  // Go to My Classes page
  await page.click('nav >> text=My Classes');
  await expect(page).toHaveURL(/teacher\/classes/);

  // Go to create class page
  await page.click('text=Create class');
  await page.waitForURL(/\/classes\/new/, { timeout: 15000 });
  await expect(page.locator('input[name="title"]')).toBeVisible({ timeout: 10000 });

  // Create a new class with a random name to avoid duplication
  const className = 'E2E-class-detail-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  await page.fill('input[name="title"]', className);
  await page.fill('input[name="subject"]', 'Calculus');
  await page.fill('input[name="level"]', 'College');
  await page.click('button:has-text("Create")');

  // Wait for the Create button to be enabled or page navigation
  await page.waitForFunction(() => {
    const btn = document.querySelector('button:has-text("Create")');
    return btn && !(btn as HTMLButtonElement).disabled;
  }, { timeout: 15000 }).catch(() => {});

  // Wait for navigation to detail page
  await page.waitForURL(/\/classes\//, { timeout: 20000 }).catch(() => {});

  // Output all visible text and error messages for debugging
  const bodyText = await page.locator('body').innerText();
  const errors = await page.locator('.text-red-500, [role=alert], [aria-live]').allTextContents();
  console.log('Page text:', bodyText);
  console.log('Error messages:', errors);

  // Assert at least one .editorial-title contains the class name
  const allTitles2 = await page.locator('.editorial-title').allTextContents();
  expect(allTitles2.some(t => t.includes(className))).toBeTruthy();
  // Assert other content
  await expect(page.locator('text=Calculus')).toBeVisible();
  await expect(page.locator('text=College')).toBeVisible();
  await expect(page.locator('text=Preview as student')).toBeVisible();

  // Test "Preview as student" navigation
  await page.click('text=Preview as student');
  await page.waitForURL(/as=student/, { timeout: 10000 });
  await expect(page.locator('text=Previewing as a student')).toBeVisible();
});

