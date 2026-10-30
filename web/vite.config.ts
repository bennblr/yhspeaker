import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { noiseSuppressionAudioWorkletVitePlugin } from '@workadventure/noise-suppression/vite';

export default defineConfig({
  plugins: [react(), noiseSuppressionAudioWorkletVitePlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        platform: 'platform.html',
        landing: 'landing.html',
      },
    },
  },
});
