import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BailianAsrDraft } from '@voxel/shared';

/** 百炼 ASR 配置存储：写盘到 .data/asr-settings.json，不进仓库。 */
const SETTINGS_PATH = new URL(
  '../../../../.data/asr-settings.json',
  import.meta.url,
);

export function validateBailianSettings(
  value: unknown,
  previous?: BailianAsrDraft,
): BailianAsrDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('识别服务配置无效。');
  const v = value as Record<string, unknown>;
  if (v.region !== 'beijing' && v.region !== 'singapore')
    throw new Error('请选择北京或新加坡地域。');
  if (v.model !== 'fun-asr-realtime' && v.model !== 'paraformer-realtime-v2')
    throw new Error('请选择支持的实时识别模型。');
  if (
    typeof v.workspaceId !== 'string' ||
    !/^[a-zA-Z0-9-]{0,80}$/.test(v.workspaceId)
  )
    throw new Error('业务空间 ID 格式无效。');
  if (
    typeof v.apiKey !== 'string' ||
    v.apiKey.length > 4096 ||
    /[\r\n\0]/.test(v.apiKey)
  )
    throw new Error('API Key 格式无效。');
  let apiKey = v.apiKey.trim();
  if (!apiKey && previous?.apiKey) {
    if (previous.region !== v.region || previous.workspaceId !== v.workspaceId)
      throw new Error('更换地域或业务空间时，请重新填写 API Key。');
    apiKey = previous.apiKey;
  }
  if (!apiKey) throw new Error('请填写 API Key。');
  return {
    region: v.region,
    model: v.model,
    workspaceId: v.workspaceId.trim(),
    apiKey,
  };
}

export function maskBailianSettings(
  settings: BailianAsrDraft | undefined,
): Partial<BailianAsrDraft> {
  if (!settings) return { apiKey: '' };
  return {
    region: settings.region,
    model: settings.model,
    workspaceId: settings.workspaceId,
    apiKey: settings.apiKey ? '••••••••' : '',
  };
}

export class AsrSettingsStore {
  private settings?: BailianAsrDraft;
  private loaded: Promise<void>;

  constructor() {
    this.loaded = this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const raw = await readFile(SETTINGS_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && 'region' in parsed) {
        this.settings = validateBailianSettings(parsed, this.settings);
      }
    } catch {
      this.settings = undefined;
    }
  }

  async get(): Promise<BailianAsrDraft | undefined> {
    await this.loaded;
    return this.settings;
  }

  async set(draft: Partial<BailianAsrDraft>): Promise<BailianAsrDraft> {
    const next = validateBailianSettings(
      { ...this.settings, ...draft },
      this.settings,
    );
    await mkdir(dirname(SETTINGS_PATH.pathname), { recursive: true });
    const tmp = `${SETTINGS_PATH.pathname}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await rename(tmp, SETTINGS_PATH.pathname);
    this.settings = next;
    return next;
  }

  async clear(): Promise<void> {
    try {
      await unlink(SETTINGS_PATH.pathname);
    } catch {
      /* 无配置可删 */
    }
    this.settings = undefined;
  }
}
