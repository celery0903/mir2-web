import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.MIR_URL ?? 'http://127.0.0.1:18880', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
