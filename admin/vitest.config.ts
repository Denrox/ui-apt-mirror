import { defineConfig } from 'vitest/config';
import path from 'path';

// Dedicated test config: the mirror-config unit tests are plain TS/Node and do
// not need the React Router or Tailwind Vite plugins, so we keep this minimal
// and just wire up the `~` path alias used across the app.
export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './app'),
    },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts'],
  },
});
