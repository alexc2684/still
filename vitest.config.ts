import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  publicDir: false,
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    globals: true,
    maxWorkers: 2,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: process.env.COVERAGE_DIR || './coverage',
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}', 'public/sw.js', 'scripts/migrate.ts', 'next.config.mjs'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'tests/**',
        '**/*.d.ts',
        'node_modules/**',
        '.next/**',
        'public/**/*.{css,png,jpg,jpeg,gif,svg,ico,webp}',
      ],
      skipFull: false,
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
    },
  },
})
