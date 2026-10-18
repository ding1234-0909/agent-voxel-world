import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          network: ['colyseus.js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Route front-end API calls to the Colyseus game server.
      '/tts': 'http://127.0.0.1:2567',
      '/ai/chat': 'http://127.0.0.1:2567',
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Production preview needs the same API routes forwarded to the game
      // server, otherwise /tts and /ai/chat would hit the static site itself.
      '/tts': 'http://127.0.0.1:2567',
      '/ai/chat': 'http://127.0.0.1:2567',
    },
  },
});
