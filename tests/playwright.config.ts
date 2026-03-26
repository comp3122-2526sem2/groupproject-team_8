import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/results/playwright', // All test artifacts (screenshots, traces, videos, etc.)
  reporter: [['list'], ['html', { outputFolder: './tests/results/playwright/html-report', open: 'never' }]],
  // You can add more config options as needed
});
