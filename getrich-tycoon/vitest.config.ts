import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { hqModelsPlugin } from './vite-plugin-hq-models';

export default defineConfig({
  plugins: [
    hqModelsPlugin({
      modelsDir: path.resolve(import.meta.dirname, 'client/public/assets/models'),
    }),
  ],
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
