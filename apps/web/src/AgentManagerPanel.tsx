import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AgentSettings,
  ManagedAgentView,
  ProviderType,
  ProviderView,
} from '@voxel/shared';
import { voiceApi } from './local-recorder';
import { readAgentResponse } from './agent-response';

async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${voiceApi()}/agents${path}`, {
    method,
    signal,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readAgentResponse<T>(response);
}
const presets = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
  },
  ollama: {
    name: '本机 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: '',
  },
  compatible: { name: 'OpenAI 兼容服务', baseUrl: '', defaultModel: '' },
};
const freshProvider = (type: ProviderType = 'compatible') => ({
  ...presets[type],
  type,
  apiKey: '',
  jsonMode: true,
  tokenField: 'max_tokens' as ProviderView['tokenField'],
});
const statusNames: Record<ManagedAgentView['status'], string> = {
  joining: '加入中',
  running: '运行中',
  idle: '在线待命',
  stopping: '停止中',
  stopped: '已关闭',
  completed: '任务已结束',
  failed: '任务异常',
};
const isActive = (job: ManagedAgentView) =>
  ['joining', 'running', 'stopping'].includes(job.status);
const initialAgent: AgentSettings = {
  providerId: '',
  model: '',
  name: 'AI 探索者',
  goal: '探索附近环境，用中文友好地介绍你的观察，回应附近玩家，避免重复发言。',
  continuous: false,
  intervalMode: 'fixed',
  intervalMinMs: 4000,
  intervalMaxMs: 8000,
  maxTurns: 20,
  intervalMs: 3000,
  timeoutMs: 60000,
  maxTokens: 512,
  allowEdits: false,
  thinking: 'disabled',
  reasoningEffort: 'high',
};
export function AgentManagerPanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'agents' | 'providers'>('agents');
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [jobs, setJobs] = useState<ManagedAgentView[]>([]);
  const [taskDraft, setTaskDraft] = useState<{ id: string; goal: string }>();
  const [agent, setAgent] = useState(initialAgent);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState(freshProvider());
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const modelRequest = useRef<AbortController | null>(null);
  const selected = providers.find((p) => p.id === agent.providerId);
  const editingProvider = providers.find((p) => p.id === editing);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    const abort = new AbortController();
    void api<ProviderView[]>('/providers', 'GET', undefined, abort.signal)
      .then((list) => {
        setProviders(list);
        if (list[0])
          setAgent((a) => ({
            ...a,
            providerId: list[0].id,
            model: list[0].defaultModel,
          }));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e.message));
      });
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        setJobs(
          await api<ManagedAgentView[]>('', 'GET', undefined, abort.signal),
        );
        setPollError('');
      } catch {
        if (!abort.signal.aborted)
          setPollError('无法刷新 Agent 状态，请检查世界服务连接。');
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      abort.abort();
      modelRequest.current?.abort();
      clearTimeout(timer);
      element.close();
      previous?.focus();
    };
  }, []);
  const chooseProvider = (id: string) => {
    modelRequest.current?.abort();
    setLoadingModels(false);
    setModels([]);
    setError('');
    setNotice('');
    const p = providers.find((p) => p.id === id);
    setAgent((a) => ({
      ...a,
      providerId: id,
      model: p?.defaultModel ?? '',
      thinking: 'disabled',
    }));
  };
  const readModels = async (id: string) => {
    modelRequest.current?.abort();
    const abort = new AbortController();
    modelRequest.current = abort;
    setLoadingModels(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ models: string[] }>(
        `/providers/${encodeURIComponent(id)}/models`,
        'GET',
        undefined,
        abort.signal,
      );
      setModels(result.models);
      setNotice(
        `连接成功，发现 ${result.models.length} 个模型。可从模型输入框选择或手动填写。`,
      );
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoadingModels(false);
    }
  };
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const editProvider = (p?: ProviderView) => {
    modelRequest.current?.abort();
    setLoadingModels(false);
    setModels([]);
    setError('');
    setNotice('');
    setEditing(p?.id);
    setDraft(
      p
        ? {
            name: p.name,
            type: p.type,
            baseUrl: p.baseUrl,
            defaultModel: p.defaultModel,
            jsonMode: p.jsonMode,
            tokenField: p.tokenField,
            apiKey: '',
          }
        : freshProvider(),
    );
  };
  const saveProvider = (e: FormEvent) => {
    e.preventDefault();
    void perform(async () => {
      const saved = await api<ProviderView>(
        editing ? `/providers/${encodeURIComponent(editing)}` : '/providers',
        editing ? 'PUT' : 'POST',
        draft,
      );
      setProviders(await api<ProviderView[]>('/providers'));
      setEditing(saved.id);
      setDraft((d) => ({ ...d, apiKey: '' }));
      setAgent((a) => ({
        ...a,
        providerId: saved.id,
        model: saved.defaultModel,
        thinking: 'disabled',
      }));
      setModels([]);
      setNotice('服务商已保存。切换到 Agent 玩家，选择模型后即可加入世界。');
    });
  };
  return (
    <dialog
      ref={dialog}
      className="agent-dialog"
      aria-labelledby="agent-title"
      onCancel={onClose}
    >
      <div className="agent-heading">
        <div>
          <div className="eyebrow">WORLD COMPANIONS</div>
          <h2 id="agent-title">Agent 控制台</h2>
          <p>配置模型服务，让 AI 以独立玩家的身份加入世界。</p>
        </div>
        <button type="button" aria-label="关闭 Agent 控制台" onClick={onClose}>
          关闭 ×
        </button>
      </div>
      <nav className="agent-tabs" aria-label="Agent 管理分类">
        <button
          aria-pressed={tab === 'agents'}
          onClick={() => {
            setTab('agents');
            setError('');
            setNotice('');
          }}
        >
          Agent 玩家{' '}
          <small>
            {jobs.filter(isActive).length} 运行中 ·{' '}
            {jobs.filter((j) => j.status === 'idle').length} 待命
          </small>
        </button>
        <button
          aria-pressed={tab === 'providers'}
          onClick={() => {
            setTab('providers');
            editProvider(selected ?? providers[0]);
          }}
        >
          模型服务商
        </button>
      </nav>
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="agent-notice">
          {notice}
        </p>
      )}
      {tab === 'providers' ? (
        <div className="agent-columns">
          <aside className="agent-sidebar">
            <h3>已保存的服务商</h3>
            {providers.map((p) => (
              <button
                key={p.id}
                aria-pressed={editing === p.id}
                onClick={() => editProvider(p)}
                disabled={busy}
              >
                {p.name}
                <small>
                  {p.type === 'ollama'
                    ? '本机 · 无需密钥'
                    : p.hasApiKey
                      ? '密钥已配置'
                      : '尚未配置密钥'}{' '}
                  · {p.defaultModel || '未设默认模型'}
                </small>
              </button>
            ))}
            <button onClick={() => editProvider()} disabled={busy}>
              ＋ 添加服务商
            </button>
            <p>
              密钥仅保存在本机服务端，不会返回到浏览器。已有环境变量会在首次启动时导入。
            </p>
          </aside>
          <form onSubmit={saveProvider} className="agent-form">
            <h3>{editing ? '编辑服务商' : '添加模型服务商'}</h3>
            <fieldset disabled={busy}>
              <label>
                服务商类型
                <select
                  value={draft.type}
                  onChange={(e) =>
                    setDraft(freshProvider(e.target.value as ProviderType))
                  }
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="ollama">本机 Ollama</option>
                  <option value="compatible">OpenAI 兼容服务</option>
                </select>
              </label>
              <label>
                服务商名称
                <input
                  value={draft.name}
                  required
                  maxLength={50}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                API Base URL
                <input
                  type="url"
                  value={draft.baseUrl}
                  required
                  placeholder="https://api.example.com/v1"
                  onChange={(e) =>
                    setDraft({ ...draft, baseUrl: e.target.value })
                  }
                />
              </label>
              {draft.type !== 'ollama' && (
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={draft.apiKey}
                    placeholder={
                      editingProvider?.hasApiKey
                        ? '已配置，留空保持现有密钥'
                        : '输入服务商 API Key'
                    }
                    onChange={(e) =>
                      setDraft({ ...draft, apiKey: e.target.value })
                    }
                  />
                </label>
              )}
              <label>
                默认模型 ID
                <input
                  value={draft.defaultModel}
                  maxLength={128}
                  placeholder="填写该服务商支持的模型 ID"
                  onChange={(e) =>
                    setDraft({ ...draft, defaultModel: e.target.value })
                  }
                />
              </label>
              <details>
                <summary>接口兼容设置</summary>
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={draft.jsonMode}
                    onChange={(e) =>
                      setDraft({ ...draft, jsonMode: e.target.checked })
                    }
                  />
                  请求 JSON 输出模式
                </label>
                <label>
                  输出长度参数
                  <select
                    value={draft.tokenField}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        tokenField: e.target
                          .value as ProviderView['tokenField'],
                      })
                    }
                  >
                    <option>max_tokens</option>
                    <option>max_completion_tokens</option>
                  </select>
                </label>
              </details>
              <p className="agent-hint">
                支持 OpenAI Chat Completions
                兼容接口。保存配置不会启动推理；新建或继续运行 Agent
                时使用最新配置。
              </p>
              <div className="agent-actions">
                <button className="primary">
                  {busy ? '保存中…' : '保存服务商'}
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() =>
                      void perform(async () => {
                        await api(
                          `/providers/${encodeURIComponent(editing)}`,
                          'DELETE',
                        );
                        const list = await api<ProviderView[]>('/providers');
                        setProviders(list);
                        if (agent.providerId === editing)
                          setAgent((a) => ({
                            ...a,
                            providerId: list[0]?.id ?? '',
                            model: list[0]?.defaultModel ?? '',
                          }));
                        editProvider();
                        setNotice('服务商已删除。');
                      })
                    }
                  >
                    删除服务商
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        </div>
      ) : (
        <div className="agent-columns">
          <form
            className="agent-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await api<ManagedAgentView>('', 'POST', {
                  ...agent,
                  maxTurns: agent.continuous ? 20 : agent.maxTurns,
                  intervalMs:
                    agent.intervalMode === 'fixed' ? agent.intervalMs : 3000,
                  intervalMinMs:
                    agent.intervalMode === 'random'
                      ? agent.intervalMinMs
                      : 4000,
                  intervalMaxMs:
                    agent.intervalMode === 'random'
                      ? agent.intervalMaxMs
                      : 8000,
                });
                setJobs(await api<ManagedAgentView[]>(''));
                setNotice('Agent 已开始加入世界。关闭面板后仍会继续运行。');
              });
            }}
          >
            <h3>创建 Agent 玩家</h3>
            <fieldset disabled={busy}>
              <label>
                选择服务商
                <select
                  required
                  value={agent.providerId}
                  onChange={(e) => chooseProvider(e.target.value)}
                >
                  <option value="" disabled>
                    请先添加服务商
                  </option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.type !== 'ollama' && !p.hasApiKey
                        ? ' · 未配置密钥'
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                选择模型
                <input
                  list="agent-models"
                  required
                  value={agent.model}
                  maxLength={128}
                  placeholder="获取模型列表，或输入模型 ID"
                  onChange={(e) =>
                    setAgent({ ...agent, model: e.target.value })
                  }
                />
                <datalist id="agent-models">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <button
                type="button"
                disabled={!selected || loadingModels}
                onClick={() => void readModels(agent.providerId)}
              >
                {loadingModels ? '连接中…' : '测试连接 / 获取模型列表'}
              </button>
              <label>
                Agent 昵称
                <input
                  required
                  maxLength={24}
                  value={agent.name}
                  onChange={(e) => setAgent({ ...agent, name: e.target.value })}
                />
              </label>
              <label>
                任务目标
                <textarea
                  required
                  rows={3}
                  maxLength={2000}
                  value={agent.goal}
                  onChange={(e) => setAgent({ ...agent, goal: e.target.value })}
                />
              </label>
              <div className="agent-grid">
                <label>
                  运行方式
                  <select
                    value={agent.continuous ? 'continuous' : 'limited'}
                    onChange={(e) =>
                      setAgent({
                        ...agent,
                        continuous: e.target.value === 'continuous',
                        maxTurns:
                          Number.isInteger(agent.maxTurns) &&
                          agent.maxTurns >= 1 &&
                          agent.maxTurns <= 200
                            ? agent.maxTurns
                            : 20,
                      })
                    }
                  >
                    <option value="limited">限定轮数</option>
                    <option value="continuous">持续运行（永久）</option>
                  </select>
                </label>
                {!agent.continuous && (
                  <label>
                    运行轮数
                    <input
                      type="number"
                      min={1}
                      max={200}
                      required
                      value={Number.isNaN(agent.maxTurns) ? '' : agent.maxTurns}
                      onChange={(e) =>
                        setAgent({ ...agent, maxTurns: e.target.valueAsNumber })
                      }
                    />
                  </label>
                )}
              </div>
              {agent.continuous && (
                <p className="agent-hint">
                  持续运行，直到手动关闭或发生终止错误。服务重启后恢复待命，可通过聊天
                  @ 或点击继续运行唤醒。
                </p>
              )}
              <label>
                轮询方式
                <select
                  value={agent.intervalMode}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      intervalMode: e.target
                        .value as AgentSettings['intervalMode'],
                    })
                  }
                >
                  <option value="fixed">固定间隔</option>
                  <option value="random">随机区间</option>
                </select>
              </label>
              {agent.intervalMode === 'fixed' ? (
                <label>
                  轮次间隔（毫秒）
                  <input
                    type="number"
                    min={1000}
                    max={60000}
                    required
                    value={
                      Number.isNaN(agent.intervalMs) ? '' : agent.intervalMs
                    }
                    onChange={(e) =>
                      setAgent({ ...agent, intervalMs: e.target.valueAsNumber })
                    }
                  />
                </label>
              ) : (
                <div className="agent-grid">
                  <label>
                    间隔下限（毫秒）
                    <input
                      type="number"
                      min={1000}
                      max={agent.intervalMaxMs || 60000}
                      required
                      value={
                        Number.isNaN(agent.intervalMinMs)
                          ? ''
                          : agent.intervalMinMs
                      }
                      onChange={(e) =>
                        setAgent({
                          ...agent,
                          intervalMinMs: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                  <label>
                    间隔上限（毫秒）
                    <input
                      type="number"
                      min={agent.intervalMinMs || 1000}
                      max={60000}
                      required
                      value={
                        Number.isNaN(agent.intervalMaxMs)
                          ? ''
                          : agent.intervalMaxMs
                      }
                      onChange={(e) =>
                        setAgent({
                          ...agent,
                          intervalMaxMs: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                </div>
              )}
              <p className="agent-hint">
                每轮结束后再等待所选间隔。随机模式每轮重新抽取区间内的等待时间，不会同时发起多个推理请求。
              </p>
              <details>
                <summary>推理参数</summary>
                <div className="agent-grid">
                  <label>
                    请求超时（毫秒）
                    <input
                      type="number"
                      min={1000}
                      max={120000}
                      step={1000}
                      required
                      value={agent.timeoutMs}
                      onChange={(e) =>
                        setAgent({
                          ...agent,
                          timeoutMs: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                  <label>
                    最大输出 tokens
                    <input
                      type="number"
                      min={128}
                      max={16384}
                      required
                      value={agent.maxTokens}
                      onChange={(e) =>
                        setAgent({
                          ...agent,
                          maxTokens: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                </div>
                {selected?.type === 'deepseek' && (
                  <div className="agent-grid">
                    <label>
                      思考模式
                      <select
                        value={agent.thinking}
                        onChange={(e) =>
                          setAgent({
                            ...agent,
                            thinking: e.target
                              .value as AgentSettings['thinking'],
                            maxTokens:
                              e.target.value === 'enabled' ? 4096 : 512,
                          })
                        }
                      >
                        <option value="disabled">关闭</option>
                        <option value="enabled">开启</option>
                      </select>
                    </label>
                    <label>
                      推理强度
                      <select
                        disabled={agent.thinking !== 'enabled'}
                        value={agent.reasoningEffort}
                        onChange={(e) =>
                          setAgent({
                            ...agent,
                            reasoningEffort: e.target
                              .value as AgentSettings['reasoningEffort'],
                          })
                        }
                      >
                        {['none', 'low', 'high', 'max'].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </details>
              <label className="agent-check">
                <input
                  type="checkbox"
                  checked={agent.allowEdits}
                  onChange={(e) =>
                    setAgent({ ...agent, allowEdits: e.target.checked })
                  }
                />
                允许放置 / 移除方块
              </label>
              <p className="agent-hint">
                启动后，目标、附近场景与聊天会发送给所选模型。云端 API
                按服务商规则计费；每轮规划一个动作。建造支持批量执行或整屋蓝图，约每秒最多
                8 块，无需逐块调用模型。
                {agent.continuous
                  ? '持续模式会继续调用模型，直至停止。'
                  : '达到轮数后留在世界待命，可通过聊天 @ 或继续运行唤醒。'}
              </p>
              <button
                className="primary"
                disabled={
                  !selected ||
                  (selected.type !== 'ollama' && !selected.hasApiKey)
                }
              >
                {busy ? '处理中…' : '创建并加入世界 ↗'}
              </button>
            </fieldset>
          </form>
          <section className="agent-runs" aria-label="Agent 运行状态">
            <h3>
              世界里的 Agent <small>最多同时在线 4 个（含待命）</small>
            </h3>
            <p className="agent-hint">
              这里显示通过控制台创建的 Agent。轮数结束后留在世界待命，聊天 @
              或继续运行会唤醒并调用模型；只有关闭 Agent
              才会离开。关闭面板不影响 Agent。
            </p>
            {pollError && (
              <p role="alert" className="agent-error">
                {pollError}
              </p>
            )}
            {!jobs.length && (
              <div className="agent-empty">
                还没有 Agent 玩家
                <br />
                <small>选择服务商和模型，创建第一位世界伙伴。</small>
              </div>
            )}
            {jobs.map((job) => (
              <article className="agent-job" key={job.id}>
                <div className="agent-job-title">
                  <strong>{job.name}</strong>
                  <span
                    className={`agent-badge ${isActive(job) ? 'active' : ''}`}
                  >
                    {statusNames[job.status]}
                  </span>
                </div>
                <p>
                  {job.providerName} · {job.model}
                </p>
                <small>
                  {job.continuous ? '持续运行' : `${job.maxTurns} 轮`} ·{' '}
                  {job.intervalMode === 'random'
                    ? `随机 ${job.intervalMinMs}–${job.intervalMaxMs} ms`
                    : `间隔 ${job.intervalMs} ms`}{' '}
                  · 方块修改
                  {job.allowEdits ? '已开启' : '关闭'}
                </small>
                <details>
                  <summary>任务与运行记录</summary>
                  <p>{job.goal}</p>
                  <pre>{job.logs.join('\n') || '正在连接世界…'}</pre>
                </details>
                {!isActive(job) && (
                  <div className="agent-job-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(
                            `/${encodeURIComponent(job.id)}/resume`,
                            'POST',
                            {},
                          );
                          setJobs(await api<ManagedAgentView[]>(''));
                        })
                      }
                    >
                      {job.sessionId ? '继续运行' : '重新加入并运行'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setTaskDraft({ id: job.id, goal: job.goal })
                      }
                    >
                      更换任务
                    </button>
                  </div>
                )}
                {taskDraft?.id === job.id && !isActive(job) && (
                  <form
                    className="agent-task-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(async () => {
                        await api(
                          `/${encodeURIComponent(job.id)}/resume`,
                          'POST',
                          { goal: taskDraft.goal },
                        );
                        setTaskDraft(undefined);
                        setJobs(await api<ManagedAgentView[]>(''));
                      });
                    }}
                  >
                    <label>
                      新任务目标
                      <textarea
                        aria-label={`${job.name}的新任务目标`}
                        maxLength={2000}
                        required
                        value={taskDraft.goal}
                        onChange={(e) =>
                          setTaskDraft({ ...taskDraft, goal: e.target.value })
                        }
                      />
                    </label>
                    <div className="agent-job-actions">
                      <button disabled={busy || !taskDraft.goal.trim()}>
                        开始新任务
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskDraft(undefined)}
                      >
                        取消
                      </button>
                    </div>
                  </form>
                )}
                {(isActive(job) ||
                  job.sessionId ||
                  job.status === 'idle' ||
                  job.status === 'failed') && (
                  <button
                    disabled={busy || job.status === 'stopping'}
                    onClick={() =>
                      void perform(async () => {
                        await api(
                          `/${encodeURIComponent(job.id)}/stop`,
                          'POST',
                          {},
                        );
                        setJobs(await api<ManagedAgentView[]>(''));
                      })
                    }
                  >
                    关闭 Agent
                  </button>
                )}
              </article>
            ))}
          </section>
        </div>
      )}
    </dialog>
  );
}
