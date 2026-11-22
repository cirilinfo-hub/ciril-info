import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Set before any module is imported (ConfigModule validates at import time).
    env: { THROTTLE_DISABLED: 'true', LOG_LEVEL: 'error', NODE_ENV: 'test' },
    // Suites share one database; run files one at a time for deterministic data.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
