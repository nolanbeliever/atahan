import path from 'node:path';
import { defineConfig } from 'vite';
import { hqModelsPlugin } from './vite-plugin-hq-models';

const serverPort = process.env.PORT ?? '3000';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [
    hqModelsPlugin({
      modelsDir: path.resolve(import.meta.dirname, 'client/public/assets/models'),
    }),
  ],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/healthz': `http://localhost:${serverPort}`,
      '/socket.io': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
});
