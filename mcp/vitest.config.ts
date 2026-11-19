import { defineConfig } from 'vitest/config';

// An own config, so no other vite.config.ts from a parent folder is picked up.
export default defineConfig({
  test: { globals: true, include: ['test/**/*.spec.ts'] },
});
