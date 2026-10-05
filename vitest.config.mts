import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/app\/(.*)$/, replacement: path.resolve(__dirname, './app/$1') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
    ],
  },
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      SKIP_ENV_VALIDATION: '1',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // Los tests de servicios comparten una BD real y hacen TRUNCATE: no pueden correr en paralelo entre archivos.
          fileParallelism: false,
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['src/features/**', 'src/components/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/features/**/*.test.{ts,tsx}', 'src/components/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
