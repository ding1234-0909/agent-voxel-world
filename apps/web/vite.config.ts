import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Route all front-end API/WS traffic to the Colyseus game server on the same
// origin, so the game works behind a public tunnel for remote players.
const gameProxy = {
  '/tts': 'http://127.0.0.1:2567',
  '/ai': 'http://127.0.0.1:2567',
  '/chat': 'http://127.0.0.1:2567',
  '/voice': 'http://127.0.0.1:2567',
  '/agents': 'http://127.0.0.1:2567',
  '/world': 'http://127.0.0.1:2567',
  // Colyseus WebSocket: strip the /colyseus prefix before forwarding, the
  // game server expects /{processId}/{roomId}.
  '/colyseus': {
    target: 'http://127.0.0.1:2567',
    ws: true,
    rewrite: (p: string) => p.replace(/^\/colyseus/, ''),
  },
};

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
    proxy: gameProxy,
  },
  preview: {
    port: 5173,
    strictPort: true,
    // Public tunnels (e.g. cloudflared trycloudflare.com) send unknown Host
    // headers; allow them so remote players can reach the game.
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: gameProxy,
  },
});
