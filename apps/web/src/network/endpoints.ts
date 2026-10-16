/** Shared transport addresses; evaluate lazily so previews and tests can override env. */
export const serverSocketUrl = () =>
  import.meta.env?.VITE_SERVER_URL ?? 'ws://127.0.0.1:2567';

export const serverHttpUrl = () => serverSocketUrl().replace(/^ws/, 'http');
