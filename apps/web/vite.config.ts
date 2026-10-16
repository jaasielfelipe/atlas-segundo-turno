import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const api = `http://127.0.0.1:${process.env.ATLAS_API_PORT ?? 3201}`;
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('maplibre-gl')) return 'map';
            if (id.includes('react')) return 'react';
          }
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.ATLAS_WEB_PORT ?? 5373),
    strictPort: true,
    proxy: { '/api': api },
  },
});
