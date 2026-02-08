import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    env: {
      MEMORY_LOG_LEVEL: 'silent',
    },
  },
});
