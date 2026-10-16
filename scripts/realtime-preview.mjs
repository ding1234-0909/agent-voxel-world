import { createServer } from '../apps/web/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
// This isolated preview intentionally does not load the project's .env or Vite config.
process.env.VITE_SERVER_URL = 'ws://127.0.0.1:2598';
const server = await createServer({
  configFile: false,
  envDir: false,
  root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
});
await server.listen();
server.printUrls();
