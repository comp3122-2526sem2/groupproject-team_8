import { type Page, expect } from '@playwright/test';
import { BASE_URL, TEACHER_EMAIL, TEACHER_PASSWORD, STUDENT_EMAIL, STUDENT_PASSWORD } from '../config';

/**
 * Log in as a teacher and wait for the dashboard.
 * Reuse this in every teacher test to avoid duplicating the login flow.
 */
export async function loginAsTeacher(page: Page) {
  if (!TEACHER_EMAIL || !TEACHER_PASSWORD) {
    throw new Error(
      'E2E_TEACHER_EMAIL and E2E_TEACHER_PASSWORD must be set. ' +
      'Export them as environment variables or edit tests/config.ts.',
    );
  }
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', TEACHER_EMAIL);
  await page.fill('input[name="password"]', TEACHER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/teacher\/dashboard/, { timeout: 15_000 });
}

/**
 * Log in as a student and wait for the dashboard.
 */
export async function loginAsStudent(page: Page) {
  if (!STUDENT_EMAIL || !STUDENT_PASSWORD) {
    throw new Error(
      'E2E_STUDENT_EMAIL and E2E_STUDENT_PASSWORD must be set. ' +
      'Export them as environment variables or edit tests/config.ts.',
    );
  }
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', STUDENT_EMAIL);
  await page.fill('input[name="password"]', STUDENT_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/student\/dashboard/, { timeout: 15_000 });
}
