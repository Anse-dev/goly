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
      include: ['src/git/parsers.ts', 'src/ports/inspector.ts'],
    },
  },
});
