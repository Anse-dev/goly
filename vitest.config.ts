import { fileURLToPath, URL } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(
        new URL('./src/test/vscode.mock.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/test/**/*.test.ts'],
    exclude: ['src/test/integration/**'],
    coverage: {
      reporter: ['text', 'html'],
      include: [
        'src/core/**/*.ts',
        'src/git/**/*.ts',
        'src/ports/**/*.ts',
        'src/review/**/*.ts',
        'src/snapshots/**/*.ts',
        'src/worktrees/**/*.ts',
      ],
    },
  },
});
