import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoiceServiceDraft, VoiceServiceView } from '@voxel/shared';
import { LocalTts, type SpeechSynthesizer } from './local-tts';
import { RemoteTts } from './remote-tts';
import { SpeechError } from './local-speech';

type SavedVoice = VoiceServiceDraft & { id: string };
const publicView = ({ apiKey, ...value }: SavedVoice): VoiceServiceView => ({
  ...value,
  capability: 'tts',
  hasApiKey: !!apiKey,
});
export function validateVoiceService(
  value: unknown,
  previous?: SavedVoice,
): SavedVoice {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SpeechError('语音服务配置无效。');
  const input = value as Record<string, unknown>;
  const str = (key: string, max: number, fallback = '') => {
    const v = input[key] ?? fallback;
    if (typeof v !== 'string' || v.length > max || /[\r\n\0]/.test(v))
      throw new SpeechError(`${key} 格式无效。`);
    return v.trim();
  };
  const type = input.type;
  if (type !== 'local' && type !== 'bailian' && type !== 'compatible')
    throw new SpeechError('请选择支持的语音服务类型。');
  const name = str('name', 50);
  if (!name) throw new SpeechError('请填写语音服务名称。');
  let baseUrl = '',
    apiKey = '',
    model = '';
  const voice = str('voice', 100);
  if (voice && !/^[\p{L}\p{N}_. ()-]+$/u.test(voice))
    throw new SpeechError('音色名称格式无效。');
  const speed = input.speed ?? 1;
  if (
    typeof speed !== 'number' ||
    !Number.isFinite(speed) ||
    speed < 0.5 ||
    speed > 2
  )
    throw new SpeechError('语速须为 0.5–2。');
  if (type !== 'local') {
    let url: URL;
    try {
      url = new URL(str('baseUrl', 500));
    } catch {
      throw new SpeechError('请填写有效的语音接口地址。');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    )
      throw new SpeechError(
        '语音接口须为 HTTPS 或本机 HTTP 地址，不能包含凭据或查询参数。',
      );
    baseUrl = url.href.replace(/\/$/, '');
    if (
      type === 'bailian' &&
      ![
        'https://dashscope.aliyuncs.com/api/v1',
        'https://dashscope-intl.aliyuncs.com/api/v1',
      ].includes(baseUrl)
    )
      throw new SpeechError('百炼请选择北京或新加坡官方接口。');
    apiKey = str('apiKey', 4096);
    if (!apiKey && previous?.apiKey) {
      if (previous.type !== type || previous.baseUrl !== baseUrl)
        throw new SpeechError('更换类型或地址时，请重新填写密钥。');
      apiKey = previous.apiKey;
    }
    if (!apiKey && !local) throw new SpeechError('请填写语音服务 API Key。');
    model = str('model', 128);
    if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/.test(model))
      throw new SpeechError('请填写有效的语音模型 ID。');
    if (!voice) throw new SpeechError('请填写音色。');
  }
  return {
    id: previous?.id ?? randomUUID(),
    name,
    type,
    baseUrl,
    apiKey,
    model,
    voice,
    speed: type === 'bailian' ? 1 : speed,
  };
}

export class VoiceServiceStore {
  private values: SavedVoice[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private deleting = new Set<string>();
  private bindings = new Map<string, string>();
  private listeners = new Set<(actor: string) => void>();
  private running = 0;
  constructor(
    readonly path = fileURLToPath(
      new URL('../../../../.data/voice-services.json', import.meta.url),
    ),
    private factory: (value: SavedVoice) => SpeechSynthesizer = (value) =>
      value.type === 'local' ? new LocalTts(value) : new RemoteTts(value),
  ) {}
  async load() {
    try {
      const saved: SavedVoice[] = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        !Array.isArray(saved) ||
        saved.length > 20 ||
        new Set(saved.map((v) => v.id)).size !== saved.length
      )
        throw Error('invalid');
      this.values = saved.map((value) => {
        if (
          typeof value.id !== 'string' ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)
        )
          throw Error('invalid');
        return { ...validateVoiceService(value), id: value.id };
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new SpeechError(
          '无法读取语音服务配置，请检查本地配置文件。',
          500,
        );
      this.values = [
        {
          ...validateVoiceService({
            name: '本机语音',
            type: 'local',
            voice: '',
            speed: 1,
          }),
          id: 'local-default',
        },
      ];
      await this.persist(this.values);
    }
  }
  list() {
    return this.values.map(publicView);
  }
  get(id: string) {
    const value = this.values.find((v) => v.id === id);
    if (!value || this.deleting.has(id))
      throw new SpeechError('语音服务不存在，请重新选择。', 404);
    return { ...value };
  }
  private async persist(values: SavedVoice[]) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(values, null, 2), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(tmp, this.path);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  private mutate<T>(fn: () => Promise<T>) {
    const operation = this.queue.then(fn);
    this.queue = operation.catch(() => {});
    return operation;
  }
  save(value: unknown, id?: string) {
    return this.mutate(async () => {
      if (!id && this.values.length >= 20)
        throw new SpeechError('最多保存 20 个语音服务。');
      const entry = validateVoiceService(value, id ? this.get(id) : undefined);
      const next = id
        ? this.values.map((v) => (v.id === id ? entry : v))
        : [...this.values, entry];
      await this.persist(next);
      this.values = next;
      for (const [actor, service] of this.bindings)
        if (service === id) this.changed(actor);
      return publicView(entry);
    });
  }
  remove(id: string, isUsed: () => boolean) {
    return this.mutate(async () => {
      this.get(id);
      if (isUsed() || [...this.bindings.values()].includes(id))
        throw new SpeechError(
          '有 Agent 正在引用此服务或保存参数，请先完成更新，并在编辑参数中更换或移除语音服务。',
          409,
        );
      this.deleting.add(id);
      try {
        const next = this.values.filter((v) => v.id !== id);
        await this.persist(next);
        this.values = next;
      } finally {
        this.deleting.delete(id);
      }
    });
  }
  onChange(listener: (actor: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed(actor: string) {
    for (const listener of this.listeners) listener(actor);
  }
  bind(actor: string, id: string) {
    if (id) this.get(id);
    if (this.bindings.get(actor) === id) return;
    this.changed(actor);
    this.bindings.set(actor, id);
  }
  unbind(actor: string) {
    this.changed(actor);
    this.bindings.delete(actor);
  }
  forActor(actor: string): SpeechSynthesizer {
    // Only trusted Agent management binds cloud services; raw world actions cannot select them.
    const id = this.bindings.get(actor);
    if (id === undefined) return new LocalTts();
    return { synthesize: (text, signal) => this.synthesize(id, text, signal) };
  }
  async synthesize(id: string, text: string, signal: AbortSignal) {
    if (typeof text !== 'string' || !text.trim() || text.length > 240)
      throw new SpeechError('试听文字需为 1–240 字。');
    const entry = this.get(id);
    if (this.running >= 2)
      throw new SpeechError('语音服务繁忙，请稍后重试。', 429);
    this.running++;
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    try {
      bounded.throwIfAborted();
      const result = await this.factory(entry).synthesize(text, bounded);
      bounded.throwIfAborted();
      return result;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof SpeechError) throw error;
      throw new SpeechError(
        bounded.aborted
          ? '语音合成超时，请重试。'
          : '语音合成失败，请检查服务配置和音频转换工具。',
        502,
      );
    } finally {
      this.running--;
    }
  }
}
