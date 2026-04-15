/// <reference types="vitest" />
import { coverageConfigDefaults,defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    clearMocks: true,
    coverage: {
      provider: 'istanbul',
      reporter: [['text', { maxCols: 200 }], ['html']],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/**/*.stories*.{ts,tsx}',
        'src/**/*.guidepup.test.tsx',
      ],
      include: ['src/**/*.{ts,tsx}'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: 'node_modules/@kinvolk/headlamp-plugin/config/setupTests.js',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.guidepup.test.tsx'],
        },
      },
      {
        test: {
          name: 'a11y',
          environment: 'jsdom',
          setupFiles: 'node_modules/@kinvolk/headlamp-plugin/config/setupTests.js',
          include: ['src/**/*.guidepup.test.tsx'],
          testTimeout: 30000,
        },
      },
    ],
  },
});
