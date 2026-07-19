import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', target: 'es2022' },
  worker: { format: 'es' },
  define: { global: 'globalThis' },
  optimizeDeps: { include: ['exceljs'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
