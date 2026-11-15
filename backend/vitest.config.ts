import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // The Report agent is off in tests, whatever the shell has set.
    env: { REPORT_AGENT: 'off', GROQ_API_KEY: '', GROQ_MODEL: '' },
  },
});
