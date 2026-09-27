/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      output: {
        // Function form: Vite 8 (Rolldown) no longer accepts the object form.
        // Same three chunks as before (radix now covers every @radix-ui
        // package, including ones added after the original list).
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@radix-ui')) return 'radix';
          if (id.includes('node_modules/motion') || id.includes('node_modules\\motion')) return 'motion';
          if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  define: { global: 'globalThis' },
  optimizeDeps: { include: ['exceljs'] },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Engine tests stay on the fast node environment. UI and hook tests opt into jsdom
    // per file with a `@vitest-environment jsdom` docblock, so only they pay for it.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['engine/**', 'src/**'],
      exclude: ['tests/**', 'node_modules/**', 'dist/**'],
      // Ratchets, set just under today's numbers so coverage cannot silently fall.
      // engine/** carries the BOQ logic a wrong number would flow through, so it is
      // held much higher than the UI-heavy global figure. Raise these as tests land.
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 45,
        lines: 55,
        'engine/**': {
          statements: 85,
          branches: 74,
          functions: 88,
          lines: 88,
        },
      },
    },
  },
});
