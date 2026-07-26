import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          mantine: ['@mantine/core'],
          motion: ['motion/react'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
  worker: { format: 'es' },
  define: { global: 'globalThis' },
  optimizeDeps: { include: ['exceljs'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['engine/**', 'src/**'],
      exclude: ['tests/**', 'node_modules/**', 'dist/**'],
    },
  },
});
