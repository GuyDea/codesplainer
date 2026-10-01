import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The API server listens on CODESPLAINER_PORT (default 4777). In dev, Vite proxies /api to it.
const apiPort = Number(process.env.CODESPLAINER_PORT ?? 4777);

export default defineConfig(({ mode }) => {
  // `vite build --mode pages`: only the graph playground (sample data, no server), as the live
  // demo on GitHub Pages. Relative asset paths, so it works under any sub-path.
  const pages = mode === 'pages';
  return {
    plugins: [react(), tailwindcss()],
    base: pages ? './' : '/',
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
    build: pages
      ? {
          outDir: 'dist-pages',
          emptyOutDir: true,
          sourcemap: false,
          chunkSizeWarningLimit: 2000,
          rolldownOptions: {
            input: { playground: fileURLToPath(new URL('./playground.html', import.meta.url)) },
          },
        }
      : {
          outDir: 'dist',
          sourcemap: true,
          chunkSizeWarningLimit: 2000,
        },
  };
});
