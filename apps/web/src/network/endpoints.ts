/** Shared transport addresses; evaluate lazily so previews and tests can override env. */
const wsProtocol = () =>
  typeof location !== 'undefined'
    ? location.protocol === 'https:'
      ? 'wss'
      : 'ws'
    : 'ws';

/**
 * 同源传输：网页服务器（5173，server.js）已内置反向代理，
 * 将 /colyseus(WS)、/voice、/ai、/chat、/world、/tts、/agents、/health
 * 转发到游戏服务器 2567。本机与公网（隧道只暴露 5173）都能正常工作，
 * 无需暴露第二个端口。VITE_SERVER_URL* 可覆盖。
 */
export const serverSocketUrl = () =>
  import.meta.env?.VITE_SERVER_URL ??
  `${wsProtocol()}://${location.host}/colyseus`;

export const serverHttpUrl = () =>
  import.meta.env?.VITE_SERVER_URL_HTTP ??
  `${location.protocol}//${location.host}`;
