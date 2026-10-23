import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    clearMocks: true,
    setupFiles: 'node_modules/@kinvolk/headlamp-plugin/config/setupTests.js',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
