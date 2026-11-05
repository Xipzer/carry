import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/e2e', fullyParallel: true, retries: 0, workers: 3, timeout: 45000,
  reporter: [['list']], use: { baseURL: 'http://127.0.0.1:5187', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --port 5187', url: 'http://127.0.0.1:5187', env: { VITE_ENABLE_MAINNET_TRANSFERS: 'true' }, reuseExistingServer: false, timeout: 60000 },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
});
