/** Shared transport addresses; evaluate lazily so previews and tests can override env. */
const wsProtocol = () =>
  typeof location !== 'undefined'
    ? location.protocol === 'https:'
      ? 'wss'
      : 'ws'
    : 'ws';

/**
 * Same-origin transport: in production the front-end is served behind one
 * public origin (e.g. a tunnel), and Vite proxies /colyseus (WS), /tts,
 * /ai, /chat, /voice, /agents and /world to the game server. External
 * players never need to know the server address.
 */
export const serverSocketUrl = () =>
  import.meta.env?.VITE_SERVER_URL ??
  `${wsProtocol()}://${location.host}/colyseus`;

export const serverHttpUrl = () =>
  import.meta.env?.VITE_SERVER_URL_HTTP ??
  `${location.protocol}//${location.host}`;
