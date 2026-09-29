import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The API server listens on CODESPLAINER_PORT (default 4777). In dev, Vite proxies /api to it.
const apiPort = Number(process.env.CODESPLAINER_PORT ?? 4777);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.CODESPLAINER_WEB_PORT ?? 5173),
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
});
