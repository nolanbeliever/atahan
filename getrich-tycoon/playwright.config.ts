import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3310);
const sqlite = path.join(os.tmpdir(), `getrich-e2e-${process.pid}.db`);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1024, height: 640 },
    browserName: 'chromium',
    launchOptions: {
      // Software WebGL so the tests run on machines/containers without a GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node dist/server/index.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'production',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      SQLITE_PATH: sqlite,
      AUTH_RATE_PER_MINUTE: '1000',
      REGISTER_PER_HOUR: '100000',
      REGISTER_GLOBAL_PER_HOUR: '100000',
      LOG_LEVEL: 'warn',
    },
  },
});
