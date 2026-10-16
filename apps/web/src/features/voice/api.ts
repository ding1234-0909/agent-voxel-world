import { serverHttpUrl } from '../../network/endpoints';
import type { SpeechCapabilities } from '../../audio/local-recorder';

export const voiceApi = {
  async capabilities(signal: AbortSignal): Promise<SpeechCapabilities> {
    const response = await fetch(`${serverHttpUrl()}/voice/capabilities`, {
      signal,
    });
    if (!response.ok) throw Error('capabilities');
    const value = await response.json();
    if (typeof value.local?.available !== 'boolean')
      throw Error('capabilities');
    return value;
  },
};
