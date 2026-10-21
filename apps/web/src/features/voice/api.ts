import { serverHttpUrl } from '../../network/endpoints';
import type { SpeechCapabilities } from '../../audio/local-recorder';
import type { BailianAsrDraft } from '@voxel/shared';

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
  async getBailianSettings(): Promise<Partial<BailianAsrDraft>> {
    const response = await fetch(`${serverHttpUrl()}/voice/asr/settings`);
    if (!response.ok) throw Error('settings');
    const value = (await response.json()) as {
      settings?: Partial<BailianAsrDraft>;
    };
    return value.settings ?? {};
  },
  async saveBailianSettings(
    draft: Partial<BailianAsrDraft>,
  ): Promise<Partial<BailianAsrDraft>> {
    const response = await fetch(`${serverHttpUrl()}/voice/asr/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const value = (await response.json()) as {
      ok?: boolean;
      error?: string;
      settings?: Partial<BailianAsrDraft>;
    };
    if (!response.ok || !value.ok)
      throw Error(value.error ?? '保存识别配置失败。');
    return value.settings ?? {};
  },
};
