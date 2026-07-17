import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const configuredChromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const systemChromiumPath = '/usr/bin/chromium';
const executablePath = configuredChromiumPath
  ?? (existsSync(systemChromiumPath) ? systemChromiumPath : undefined);
const launchOptions = {
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-compositing'],
  ...(executablePath === undefined ? {} : { executablePath }),
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-report' }]],
  outputDir: 'artifacts/playwright-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions,
  },
  projects: [
    {
      name: 'mobile-portrait',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 412, height: 915 },
      },
    },
    {
      name: 'desktop-landscape',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
