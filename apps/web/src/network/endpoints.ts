/** Shared transport addresses; evaluate lazily so previews and tests can override env. */
const wsProtocol = () =>
  typeof location !== 'undefined'
    ? location.protocol === 'https:'
      ? 'wss'
      : 'ws'
    : 'ws';

/**
 * 本机直连游戏服务器（端口 2567，服务器监听 0.0.0.0）。
 * 用页面所在的主机名（127.0.0.1 / localhost / 局域网 IP）+ 2567，
 * 因此无论用户从哪个本机地址打开游戏，语音 / AI / 世界连接都可用，
 * 不再依赖网页服务器的反向代理。环境变量 VITE_SERVER_URL* 可覆盖。
 */
const serverHost = () => {
  if (typeof location === 'undefined') return '127.0.0.1';
  return location.hostname === '' ? '127.0.0.1' : location.hostname;
};

export const serverSocketUrl = () =>
  import.meta.env?.VITE_SERVER_URL ??
  `${wsProtocol()}://${serverHost()}:2567/colyseus`;

export const serverHttpUrl = () =>
  import.meta.env?.VITE_SERVER_URL_HTTP ??
  `${location.protocol}//${serverHost()}:2567`;
