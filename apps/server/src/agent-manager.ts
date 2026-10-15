import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentSettings,
  ManagedAgentView,
  ProviderView,
} from '@voxel/shared';
import { Session } from '../../agent/src/session';
import {
  ModelPlanner,
  DeepSeekError,
  listModels,
  runAgent,
  type AgentConfig,
} from '../../agent/src/deepseek';

export class ManagementError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export type SavedProvider = Omit<ProviderView, 'hasApiKey'> & {
  apiKey: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ManagementError('请求格式无效。');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max)
    throw new ManagementError(`${label}格式无效。`);
  return value.trim();
}
function integer(
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new ManagementError(`${label}须为 ${min}–${max} 的整数。`);
  return value;
}
function boolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ManagementError('开关参数无效。');
  return value;
}
export function validateProvider(
  value: unknown,
  previous?: SavedProvider,
): SavedProvider {
  const input = object(value);
  const type = input.type;
  if (type !== 'deepseek' && type !== 'ollama' && type !== 'compatible')
    throw new ManagementError('不支持此服务商类型。');
  const name = text(input.name, '服务商名称', 50);
  if (!name) throw new ManagementError('请输入服务商名称。');
  const defaults = {
    deepseek: 'https://api.deepseek.com',
    ollama: 'http://127.0.0.1:11434/v1',
    compatible: '',
  };
  let url: URL;
  try {
    url = new URL(text(input.baseUrl, '接口地址', 500, defaults[type]));
  } catch {
    throw new ManagementError('请输入有效的 API Base URL。');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new ManagementError(
      '接口须为 HTTPS 或本机 HTTP 地址，不能包含密码、查询参数或锚点。',
    );
  if (type === 'deepseek' && url.origin !== 'https://api.deepseek.com')
    throw new ManagementError(
      'DeepSeek 使用官方地址；第三方网关请选择 OpenAI 兼容服务。',
    );
  if (type === 'ollama' && !loopback)
    throw new ManagementError('本机 Ollama 仅支持本机地址。');
  const baseUrl = url.href.replace(/\/$/, '');
  const apiKey = text(input.apiKey, 'API Key', 4096);
  if (
    previous?.apiKey &&
    !apiKey &&
    (new URL(previous.baseUrl).origin !== url.origin || previous.type !== type)
  )
    throw new ManagementError('更换服务地址或类型时，请重新填写 API Key。');
  const tokenField = input.tokenField ?? 'max_tokens';
  if (tokenField !== 'max_tokens' && tokenField !== 'max_completion_tokens')
    throw new ManagementError('输出长度参数无效。');
  return {
    id: previous?.id ?? randomUUID(),
    name,
    type,
    baseUrl,
    apiKey: apiKey || previous?.apiKey || '',
    defaultModel: text(input.defaultModel, '默认模型', 128),
    jsonMode: boolean(input.jsonMode, true),
    tokenField,
  };
}
export function validateAgent(
  value: unknown,
  provider: SavedProvider,
): AgentSettings {
  const input = object(value);
  const model = text(input.model, '模型', 128, provider.defaultModel);
  if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+\-]{0,127}$/.test(model))
    throw new ManagementError('请输入有效模型 ID。');
  if (provider.type === 'ollama' && /cloud/i.test(model))
    throw new ManagementError('本机 Ollama 请选择已下载的本地模型。');
  if (provider.type !== 'ollama' && !provider.apiKey)
    throw new ManagementError('请先为该服务商配置 API Key。');
  const name = text(input.name, '玩家昵称', 24);
  const goal = text(input.goal, '任务目标', 2000);
  if (!name || !goal) throw new ManagementError('请填写玩家昵称和任务目标。');
  const thinking = input.thinking ?? 'disabled';
  const reasoningEffort = input.reasoningEffort ?? 'high';
  if (thinking !== 'enabled' && thinking !== 'disabled')
    throw new ManagementError('思考模式无效。');
  if (
    typeof reasoningEffort !== 'string' ||
    !['none', 'low', 'high', 'max'].includes(reasoningEffort)
  )
    throw new ManagementError('推理强度无效。');
  if (provider.type !== 'deepseek' && thinking !== 'disabled')
    throw new ManagementError('此服务商暂不提供 DeepSeek 思考参数。');
  const intervalMode = input.intervalMode ?? 'fixed';
  if (intervalMode !== 'fixed' && intervalMode !== 'random')
    throw new ManagementError('轮询方式无效。');
  const intervalMinMs = integer(
    input.intervalMinMs,
    '随机间隔下限',
    4000,
    1000,
    60000,
  );
  const intervalMaxMs = integer(
    input.intervalMaxMs,
    '随机间隔上限',
    8000,
    1000,
    60000,
  );
  if (intervalMinMs > intervalMaxMs)
    throw new ManagementError('随机间隔下限不能大于上限。');
  return {
    continuous: boolean(input.continuous, false),
    intervalMode,
    intervalMinMs,
    intervalMaxMs,
    providerId: provider.id,
    model,
    name,
    goal,
    thinking,
    reasoningEffort: reasoningEffort as AgentSettings['reasoningEffort'],
    maxTurns: integer(input.maxTurns, '轮数', 20, 1, 200),
    intervalMs: integer(input.intervalMs, '轮次间隔', 3000, 1000, 60000),
    timeoutMs: integer(input.timeoutMs, '推理超时', 60000, 1000, 120000),
    maxTokens: integer(
      input.maxTokens,
      '输出长度',
      thinking === 'enabled' ? 4096 : 512,
      128,
      16384,
    ),
    allowEdits: boolean(input.allowEdits, false),
  };
}
export const providerView = ({
  apiKey,
  ...provider
}: SavedProvider): ProviderView => ({ ...provider, hasApiKey: !!apiKey });

export class ProviderStore {
  private values: SavedProvider[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly path = fileURLToPath(
      new URL('../../../.data/agent-providers.json', import.meta.url),
    ),
  ) {}
  async load(env = process.env) {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(saved) || saved.length > 20) throw Error('invalid');
      this.values = saved.map((p: SavedProvider) => {
        if (typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id))
          throw Error('invalid');
        return { ...validateProvider(p), id: p.id };
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new ManagementError(
          '无法读取服务商配置，请检查本地配置文件。',
          500,
        );
      this.values = [
        {
          ...validateProvider({
            name: 'DeepSeek',
            type: 'deepseek',
            apiKey: env.DEEPSEEK_API_KEY ?? '',
            defaultModel: env.DEEPSEEK_MODEL || 'deepseek-flash',
          }),
          id: 'deepseek',
        },
        {
          ...validateProvider({
            name: '本机 Ollama',
            type: 'ollama',
            defaultModel: env.OLLAMA_MODEL ?? '',
          }),
          id: 'ollama',
        },
      ];
      await this.persist(this.values);
    }
  }
  list() {
    return this.values.map(providerView);
  }
  get(id: string) {
    const provider = this.values.find((p) => p.id === id);
    if (!provider) throw new ManagementError('服务商不存在。', 404);
    return { ...provider };
  }
  private async persist(values: SavedProvider[]) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(values, null, 2), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(fn);
    this.queue = operation.catch(() => {});
    return operation;
  }
  save(value: unknown, id?: string) {
    return this.mutate(async () => {
      if (!id && this.values.length >= 20)
        throw new ManagementError('最多保存 20 个服务商。');
      const provider = validateProvider(value, id ? this.get(id) : undefined);
      const next = id
        ? this.values.map((p) => (p.id === id ? provider : p))
        : [...this.values, provider];
      await this.persist(next);
      this.values = next;
      return providerView(provider);
    });
  }
  remove(id: string) {
    return this.mutate(async () => {
      this.get(id);
      const next = this.values.filter((p) => p.id !== id);
      await this.persist(next);
      this.values = next;
    });
  }
}

type Job = {
  view: ManagedAgentView;
  abort: AbortController;
  session?: Session;
  done?: Promise<void>;
};
const active = (status: ManagedAgentView['status']) =>
  ['joining', 'running', 'stopping'].includes(status);
export class AgentManager {
  private jobs = new Map<string, Job>();
  private closing = false;
  private probing = new Set<string>();
  constructor(
    readonly providers: ProviderStore,
    private serverUrl: string,
    private dependencies = {
      session: (url: string) => new Session(url),
      planner: (config: AgentConfig, provider: SavedProvider) =>
        new ModelPlanner(config, fetch, provider),
      models: (provider: SavedProvider) =>
        listModels(provider, provider.apiKey),
    },
  ) {}
  list() {
    return [...this.jobs.values()]
      .map(({ view }) => ({ ...view, logs: [...view.logs] }))
      .reverse();
  }
  async models(id: string) {
    if (this.probing.has(id))
      throw new ManagementError('正在连接此服务商，请稍候。', 429);
    const provider = this.providers.get(id);
    if (provider.type !== 'ollama' && !provider.apiKey)
      throw new ManagementError('请先配置 API Key。');
    this.probing.add(id);
    try {
      return await this.dependencies.models(provider);
    } catch {
      throw new ManagementError(
        '无法获取模型列表，请检查地址、密钥和服务状态。支持的模型 ID 也可手动填写。',
        502,
      );
    } finally {
      this.probing.delete(id);
    }
  }
  create(value: unknown) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const provider = this.providers.get(
      text(object(value).providerId, '服务商', 80),
    );
    const settings = validateAgent(value, provider);
    if (
      [...this.jobs.values()].filter((j) => active(j.view.status)).length >= 4
    )
      throw new ManagementError(
        '最多同时运行 4 个受管理的 Agent，请先停止一个。',
        409,
      );
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < 50) break;
      if (!active(job.view.status)) this.jobs.delete(id);
    }
    const job: Job = {
      view: {
        ...settings,
        id: randomUUID(),
        providerName: provider.name,
        status: 'joining',
        createdAt: Date.now(),
        logs: [],
      },
      abort: new AbortController(),
    };
    this.jobs.set(job.view.id, job);
    job.done = this.execute(job, provider);
    return { ...job.view, logs: [...job.view.logs] };
  }
  private async execute(job: Job, provider: SavedProvider) {
    const log = (message: string) => {
      // Configurable providers/nicknames can contain user input; never return the key.
      const safe = provider.apiKey
        ? message.split(provider.apiKey).join('[已隐藏]')
        : message;
      job.view.logs = [...job.view.logs, safe].slice(-40);
    };
    let finalStatus: ManagedAgentView['status'] = 'completed';
    try {
      const config: AgentConfig = { ...job.view, apiKey: provider.apiKey };
      job.session = this.dependencies.session(this.serverUrl);
      await job.session.join(job.view.name, 'ai-agent');
      job.view.sessionId = job.session.room.sessionId;
      if (!job.abort.signal.aborted) {
        job.view.status = 'running';
        log('已加入世界。');
        await runAgent(
          job.session,
          this.dependencies.planner(config, provider),
          config,
          job.abort.signal,
          log,
        );
      }
      finalStatus = job.abort.signal.aborted ? 'stopped' : 'completed';
    } catch (error) {
      finalStatus = job.abort.signal.aborted ? 'stopped' : 'failed';
      if (!job.abort.signal.aborted)
        log(
          error instanceof DeepSeekError
            ? error.message
            : '无法加入世界或执行动作，请检查世界连接和模型配置。',
        );
    } finally {
      await job.session
        ?.close()
        .catch(() => job.session?.room?.connection.close());
      job.view.status = job.abort.signal.aborted ? 'stopped' : finalStatus;
    }
  }
  stop(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (active(job.view.status)) {
      job.view.status = 'stopping';
      job.abort.abort();
      void job.session
        ?.close()
        .catch(() => job.session?.room?.connection.close());
    }
    return { ...job.view, logs: [...job.view.logs] };
  }
  async removeProvider(id: string) {
    if (
      [...this.jobs.values()].some(
        (j) => j.view.providerId === id && active(j.view.status),
      )
    )
      throw new ManagementError('请先停止使用该服务商的 Agent。', 409);
    await this.providers.remove(id);
  }
  async close() {
    this.closing = true;
    for (const id of this.jobs.keys()) this.stop(id);
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
  }
}
