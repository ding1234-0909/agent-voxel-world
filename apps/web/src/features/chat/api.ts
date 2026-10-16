import { serverHttpUrl } from '../../network/endpoints';

export const chatApi = {
  async downloadAudio(id: string, token: string, signal: AbortSignal) {
    const response = await fetch(
      `${serverHttpUrl()}/chat/audio/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    );
    if (!response.ok) throw Error('语音已过期或无法访问。');
    const blob = await response.blob();
    if (signal.aborted) throw Error('已取消加载。');
    return blob;
  },
  async uploadAudio(
    clip: Blob,
    scope: 'public' | 'private',
    recipients: string[],
    token: string,
    signal: AbortSignal,
  ): Promise<{ transcriptAvailable: boolean }> {
    const params = new URLSearchParams({
      scope,
      to: recipients.join(','),
      language: 'zh',
    });
    const response = await fetch(`${serverHttpUrl()}/chat/audio?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': clip.type, Authorization: `Bearer ${token}` },
      body: clip,
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '语音发送失败。');
    return data;
  },
};
