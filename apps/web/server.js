// 我的世界-AI小学：游戏网页静态服务器 + 反向代理
// - 静态资源：dist/ 目录
// - 反向代理：/colyseus(WebSocket)、/voice、/ai、/chat、/world、/tts、/agents、/health → 127.0.0.1:2567
// 这样公网只需暴露 5173 一个端口，语音与 AI 对话全走同一通道。
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = Number(process.env.WEB_PORT || 5173);
const GAME = process.env.GAME_SERVER || 'http://127.0.0.1:2567';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const PROXY_PREFIXES = ['/colyseus', '/voice', '/ai', '/chat', '/world', '/tts', '/agents', '/health'];

async function tryRead(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const needProxy = PROXY_PREFIXES.some(
    (p) => url.pathname === p || url.pathname.startsWith(p + '/'),
  );
  if (needProxy) {
    const upstream = new URL(GAME);
    const isHttps = upstream.protocol === 'https:';
    const mod = isHttps ? https : http;
    const preq = mod.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: upstream.host },
      },
      (pres) => {
        res.writeHead(pres.statusCode ?? 502, pres.headers);
        pres.pipe(res);
      },
    );
    preq.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end('上游服务不可用');
      } else res.end();
    });
    req.pipe(preq);
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '/index.html') path = '/index.html';
  const file = join(DIST, path);
  if (!file.startsWith(DIST)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  let body = await tryRead(file);
  if (body === null && !extname(path)) {
    body = await tryRead(join(DIST, path + '.html'));
  }
  if (body === null) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-cache');
  res.end(body);
});

// WebSocket 升级转发（/colyseus 等）→ 游戏服务器
server.on('upgrade', (req, socket, head) => {
  const upstream = new URL(GAME);
  const target = net.connect(Number(upstream.port), upstream.hostname, () => {
    const raw =
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n') +
      '\r\n\r\n';
    target.write(raw);
    if (head && head.length) target.write(head);
  });
  socket.on('error', () => target.destroy());
  target.on('error', () => socket.destroy());
  socket.pipe(target);
  target.pipe(socket);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI小学网页服务已启动: http://127.0.0.1:${PORT}`);
  console.log(`游戏API/语音代理: ${GAME}`);
});
