import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ChatData,
  AgentSettings,
  ManagedAgentView,
  ProviderView,
} from '@voxel/shared';
import {
  Session,
  runTaskStep,
  newTask,
  restoreBatchHistory,
  AgentAttention,
  ModelPlanner,
  AgentRuntimeError,
  listModels,
  nextIntervalMs,
  type AgentConfig,
  type Planner,
  type AgentRunState,
} from '@voxel/agent-runtime';

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
    maxTurns: integer(input.maxTurns, '任务调用上限', 100, 1, 200),
    tokenBudget: integer(
      input.tokenBudget,
      '任务 token 预算',
      50000,
      1000,
      1000000,
    ),
    taskTimeoutMs: integer(
      input.taskTimeoutMs,
      '任务时间上限',
      900000,
      1000,
      7200000,
    ),
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
    voiceReplies: boolean(input.voiceReplies, false),
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
      new URL('../../../../.data/agent-providers.json', import.meta.url),
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
  memory: AgentRunState;
  attention: AgentAttention;
  updating?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  controlling?: boolean;
};
const active = (status: ManagedAgentView['status']) =>
  ['joining', 'running', 'stopping'].includes(status);
const resident = (job: Job) => !!job.session || active(job.view.status);
export class AgentManager {
  private jobs = new Map<string, Job>();
  private closing = false;
  private probing = new Set<string>();
  private saving: Promise<void> = Promise.resolve();
  private get archivePath() {
    return `${this.providers.path}.agents.json`;
  }
  private persist() {
    if (this.closing) return;
    const data = JSON.stringify(
      this.list()
        .reverse()
        .map((view) => ({
          ...view,
          sessionId: undefined,
          runtime: this.jobs.get(view.id)?.memory,
        })),
      null,
      2,
    );
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        const temp = `${this.archivePath}.tmp`;
        await writeFile(temp, data, { mode: 0o600 });
        await rename(temp, this.archivePath);
      });
    void this.saving.catch(() => console.error('无法保存 Agent 记录。'));
  }
  async load() {
    let saved: (ManagedAgentView & { runtime?: AgentRunState })[];
    try {
      saved = JSON.parse(await readFile(this.archivePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new ManagementError('无法读取 Agent 记录。', 500);
    }
    if (!Array.isArray(saved) || saved.length > 50)
      throw new ManagementError('Agent 记录格式无效。', 500);
    for (const view of saved) {
      const provider = this.providers.get(view.providerId);
      const settings = validateAgent(view, provider);
      if (typeof view.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(view.id))
        throw new ManagementError('Agent 标识无效。', 500);
      const job: Job = {
        view: {
          ...settings,
          id: view.id,
          createdAt: view.createdAt,
          providerName: provider.name,
          status: 'stopped',
          logs: Array.isArray(view.logs)
            ? view.logs.filter((x) => typeof x === 'string').slice(-40)
            : [],
        },
        abort: new AbortController(),
        memory: view.runtime ?? {
          task: {
            ...newTask(settings.goal),
            status: 'paused',
            reason: '旧任务已迁移，请确认后继续。',
          },
        },
        attention: new AgentAttention(),
      };
      job.memory.previous = restoreBatchHistory(job.memory.previous);
      if (
        job.memory.task &&
        ['running', 'waiting'].includes(job.memory.task.status)
      ) {
        job.memory.task.status = 'paused';
        job.memory.task.reason = '服务重启，任务进度已保留，请手动继续。';
      }
      if (job.memory.task && !job.memory.task.privateTo)
        delete job.memory.task.owner;
      if (job.memory.task?.privateTo) {
        job.memory.audienceExpired = true;
        job.memory.task.status = 'needs_input';
        job.memory.task.reason =
          '服务重启后原私聊会话已失效，请在控制台重新布置任务。';
      }
      this.jobs.set(view.id, job);
      if (
        ['idle', 'running', 'joining', 'failed'].includes(view.status) &&
        [...this.jobs.values()].filter(resident).length < 4
      ) {
        job.view.status = 'joining';
        job.done = this.execute(job, provider, false);
        await job.done;
      }
    }
    this.persist();
    await this.saving;
  }
  constructor(
    readonly providers: ProviderStore,
    private serverUrl: string,
    private dependencies = {
      session: (url: string) => new Session(url),
      planner: (config: AgentConfig, provider: SavedProvider): Planner =>
        new ModelPlanner(config, fetch, provider),
      models: (provider: SavedProvider) =>
        listModels(provider, provider.apiKey),
    },
  ) {}
  list() {
    return [...this.jobs.values()]
      .map(({ view, memory }) =>
        structuredClone({
          ...view,
          goal: memory.task?.goal ?? view.goal,
          task: memory.task,
          usage: memory.usage,
          lastResponse: memory.lastResponse,
          logs: [...view.logs],
        }),
      )
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
    if ([...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError(
        '最多同时在线 4 个受管理的 Agent（含待命），请先关闭一个。',
        409,
      );
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < 50) break;
      if (!resident(job) && ['stopped', 'completed'].includes(job.view.status))
        this.jobs.delete(id);
    }
    if (this.jobs.size >= 50)
      throw new ManagementError(
        '最多保存 50 个 Agent，请先关闭不再使用的 Agent。',
        409,
      );
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
      memory: { task: newTask(settings.goal) },
      attention: new AgentAttention(),
    };
    this.jobs.set(job.view.id, job);
    job.done = this.execute(job, provider);
    this.persist();
    return this.list().find((v) => v.id === job.view.id)!;
  }
  resume(id: string, value: unknown = {}) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (active(job.view.status) || job.updating || job.controlling)
      throw new ManagementError('Agent 正在运行或关闭，请稍候。', 409);
    const input = object(value);
    if (job.memory.audienceExpired && input.goal === undefined)
      throw new ManagementError(
        '原私聊会话已失效，请重新布置任务，避免向错误的玩家发送进展。',
        409,
      );
    const provider = this.providers.get(job.view.providerId);
    const settings = validateAgent(
      {
        ...job.view,
        goal: input.goal ?? job.memory.task?.goal ?? job.view.goal,
      },
      provider,
    );
    if (!job.session && [...this.jobs.values()].filter(resident).length >= 4)
      throw new ManagementError('最多同时在线 4 个 Agent，请先关闭一个。', 409);
    clearTimeout(job.timer);
    if (
      input.goal !== undefined ||
      !job.memory.task ||
      ['completed', 'cancelled'].includes(job.memory.task.status)
    ) {
      job.memory = { usage: job.memory.usage, task: newTask(settings.goal) };
    } else {
      const task = job.memory.task;
      if (task.status === 'budget') {
        task.calls = 0;
        task.tokens = 0;
        task.elapsedMs = 0;
        task.estimated = false;
      }
      task.status = 'running';
      task.reason = '';
      job.memory.failures = 0;
      job.memory.noProgress = 0;
    }
    Object.assign(job.view, settings, {
      providerName: provider.name,
      status: job.session ? 'running' : 'joining',
    });
    job.abort = new AbortController();
    job.done = this.execute(job, provider);
    this.persist();
    return this.list().find((v) => v.id === job.view.id)!;
  }
  async update(id: string, value: unknown) {
    if (this.closing) throw new ManagementError('世界服务正在关闭。', 503);
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (active(job.view.status) || job.updating || job.controlling)
      throw new ManagementError('请等待 Agent 待命，或关闭后再修改参数。', 409);
    const input = object(value);
    const provider = this.providers.get(
      text(input.providerId, '服务商', 80, job.view.providerId),
    );
    const currentGoal = job.memory.task?.goal ?? job.view.goal;
    const settings = validateAgent(
      { ...job.view, goal: currentGoal, ...input },
      provider,
    );
    job.updating = true;
    try {
      const session = job.session;
      if (session && settings.voiceReplies !== job.view.voiceReplies) {
        const result = await session.request('agent.voice', {
          enabled: !!settings.voiceReplies,
        });
        if (!result.ok || job.session !== session || active(job.view.status))
          throw new ManagementError('语音开关未保存，请刷新后重试。', 409);
      }
      if (session && settings.name !== job.view.name) {
        const result = await session.request('rename', { name: settings.name });
        if (!result.ok || job.session !== session || active(job.view.status))
          throw new ManagementError(
            '角色状态已变化，未保存参数，请刷新后重试。',
            409,
          );
      }
      if (
        settings.goal !== currentGoal ||
        settings.providerId !== job.view.providerId ||
        settings.model !== job.view.model ||
        settings.allowEdits !== job.view.allowEdits
      ) {
        clearTimeout(job.timer);
        job.memory = {
          usage: job.memory.usage,
          task: {
            ...newTask(settings.goal),
            status: 'paused',
            reason: '参数已修改，等待继续。',
          },
        };
        job.attention.clear();
      }
      Object.assign(job.view, settings, { providerName: provider.name });
      this.persist();
      await this.saving;
      return this.list().find((v) => v.id === job.view.id)!;
    } finally {
      job.updating = false;
      this.schedule(job);
    }
  }
  async setVoice(id: string, value: unknown) {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      this.closing ||
      job.updating ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    const enabled = boolean(object(value).enabled, false);
    job.updating = true;
    try {
      if (job.session?.room) {
        const result = await job.session.request('agent.voice', { enabled });
        if (!result.ok)
          throw new ManagementError('语音开关未生效，请重试。', 409);
      }
      job.view.voiceReplies = enabled;
      this.persist();
      await this.saving;
      return this.list().find((v) => v.id === job.view.id)!;
    } finally {
      job.updating = false;
      this.schedule(job);
    }
  }
  private wake(job: Job) {
    if (
      this.closing ||
      job.controlling ||
      job.updating ||
      (job.view.status !== 'idle' &&
        !(job.view.status === 'failed' && job.attention.pending)) ||
      !job.session
    )
      return;
    clearTimeout(job.timer);
    job.view.status = 'running';
    job.abort = new AbortController();
    job.done = this.execute(job, this.providers.get(job.view.providerId));
  }
  private schedule(job: Job) {
    clearTimeout(job.timer);
    if (
      this.closing ||
      job.controlling ||
      job.updating ||
      (job.view.status !== 'idle' &&
        !(job.view.status === 'failed' && job.attention.pending)) ||
      !job.session
    )
      return;
    if (job.attention.pending) {
      job.timer = setTimeout(() => this.wake(job), 0);
    } else if (['running', 'waiting'].includes(job.memory.task?.status ?? '')) {
      job.timer = setTimeout(() => this.wake(job), nextIntervalMs(job.view));
    }
    job.timer?.unref();
  }
  async controlTask(id: string, operation: 'pause' | 'cancel') {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      this.closing ||
      job.updating ||
      job.controlling ||
      ['joining', 'stopping'].includes(job.view.status)
    )
      throw new ManagementError('Agent 状态正在更新，请稍候。', 409);
    job.controlling = true;
    clearTimeout(job.timer);
    job.attention.clear();
    job.abort.abort();
    try {
      await job.done;
      if (job.memory.task) {
        job.memory.task.status = operation === 'pause' ? 'paused' : 'cancelled';
        job.memory.task.reason =
          operation === 'pause' ? '已由玩家暂停，进度保留。' : '已由玩家取消。';
      }
      if (operation === 'cancel') {
        job.memory.previous = undefined;
        job.memory.unfinishedBuild = undefined;
      }
      if (job.session) job.view.status = 'idle';
      this.persist();
      await this.saving;
      return this.list().find((v) => v.id === id)!;
    } finally {
      job.controlling = false;
    }
  }
  async assignTask(id: string, value: unknown) {
    const goal = text(object(value).goal, '任务目标', 2000);
    if (!goal) throw new ManagementError('请填写任务目标。');
    await this.controlTask(id, 'pause');
    return this.resume(id, { goal });
  }
  private async execute(job: Job, provider: SavedProvider, run = true) {
    const log = (message: string) => {
      // Configurable providers/nicknames can contain user input; never return the key.
      const safe = provider.apiKey
        ? message.split(provider.apiKey).join('[已隐藏]')
        : message;
      job.view.logs = [...job.view.logs, safe].slice(-40);
      this.persist();
    };
    let finalStatus: ManagedAgentView['status'] = 'idle';
    try {
      const config: AgentConfig = { ...job.view, apiKey: provider.apiKey };
      if (!job.session) {
        const session = this.dependencies.session(this.serverUrl);
        job.attention = new AgentAttention();
        job.session = session;
        await session.join(job.view.name, 'ai-agent');
        job.view.sessionId = session.room.sessionId;
        session.onEvent = (event) => {
          if (
            this.closing ||
            job.controlling ||
            job.session !== session ||
            !['running', 'idle', 'failed'].includes(job.view.status)
          )
            return;
          if (!job.attention.push(event, session.room.sessionId)) return;
          const command = (event.data as ChatData).text
            .trim()
            .replace(/^@[^\n]+?\s+(?=(?:暂停|停止|取消|别建))/u, '')
            .replace(/[！!。.?？\s]+$/u, '');
          const task = job.memory.task;
          if (
            task &&
            (!task.owner || task.owner === event.actor) &&
            (!task.privateTo ||
              (task.privateTo === event.actor &&
                (event.data as ChatData).scope !== 'public')) &&
            /^(暂停|暂停任务|停止|停止任务|别建了|取消|取消任务)$/u.test(
              command,
            )
          ) {
            void this.controlTask(
              job.view.id,
              command.startsWith('取消') ? 'cancel' : 'pause',
            )
              .then(() =>
                session.request('chat', {
                  text: command.startsWith('取消')
                    ? '任务已取消，我会留在这里待命。'
                    : '任务已暂停，进度已保留。',
                  scope: 'private',
                  recipients: [event.actor],
                }),
              )
              .catch(() => {});
            return;
          }
          if (['idle', 'failed'].includes(job.view.status)) {
            log('收到玩家消息，处理一次唤醒。');
            this.wake(job);
          }
        };
        session.room.onMessage(
          'agent.speech.error',
          (value: { message: string }) => log(`语音：${value.message}`),
        );
        session.room.onLeave(() => {
          if (job.session !== session) return;
          job.session = undefined;
          delete job.view.sessionId;
          job.abort.abort();
          if (job.view.status !== 'stopping') {
            job.view.status = 'failed';
            log('世界连接已断开，可点击继续运行重新加入。');
          }
          this.persist();
        });
        log('已加入世界。');
      }
      const voiceResult = await job.session.request('agent.voice', {
        enabled: !!job.view.voiceReplies,
      });
      if (!voiceResult.ok) log('语音回复开关未生效，请检查服务器版本。');
      if (!job.abort.signal.aborted && run) {
        job.view.status = 'running';
        log(job.attention.pending ? '处理当前消息。' : '推进一次任务决策。');
        await runTaskStep(
          job.session,
          this.dependencies.planner(config, provider),
          config,
          job.abort.signal,
          job.memory,
          job.attention,
          log,
          () => this.persist(),
        );
      }
      finalStatus =
        job.abort.signal.aborted && !job.controlling ? 'failed' : 'idle';
      if (finalStatus === 'idle')
        log(
          run
            ? '本次唤醒结束，按任务状态安排下一次检查。'
            : '服务恢复，已回到世界待命；可通过 @ 或继续运行唤醒。',
        );
    } catch (error) {
      finalStatus = 'failed';
      if (!job.abort.signal.aborted)
        log(
          error instanceof AgentRuntimeError
            ? error.message
            : '无法加入世界或执行动作，请检查世界连接和模型配置。',
        );
    } finally {
      if (!job.view.sessionId) {
        await job.session
          ?.close()
          .catch(() => job.session?.room?.connection.close());
        job.session = undefined;
      }
      if (job.view.status !== 'stopping') job.view.status = finalStatus;
      this.persist();
      this.schedule(job);
    }
  }
  stop(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new ManagementError('Agent 不存在。', 404);
    if (
      job.view.status !== 'stopping' &&
      (resident(job) || job.view.status !== 'stopped')
    ) {
      clearTimeout(job.timer);
      job.view.status = 'stopping';
      job.attention.clear();
      job.abort.abort();
      const closed = job.session
        ?.close()
        .catch(() => job.session?.room?.connection.close());
      const previous = job.done;
      job.done = (async () => {
        await Promise.allSettled([previous, closed]);
        await job.session
          ?.close()
          .catch(() => job.session?.room?.connection.close());
        job.session = undefined;
        delete job.view.sessionId;
        job.view.status = 'stopped';
        this.persist();
      })();
    }
    return this.list().find((v) => v.id === job.view.id)!;
  }
  async removeProvider(id: string) {
    if ([...this.jobs.values()].some((j) => j.view.providerId === id))
      throw new ManagementError(
        '已有可复用 Agent 关联此服务商，请保留配置或更新其密钥。',
        409,
      );
    await this.providers.remove(id);
  }
  async close() {
    this.persist();
    this.closing = true;
    await this.saving;
    for (const id of this.jobs.keys()) this.stop(id);
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
  }
}
