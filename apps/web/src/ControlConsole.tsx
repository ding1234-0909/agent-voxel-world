import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ComponentProps,
} from 'react';
import type {
  AgentSettings,
  AgentTaskStatus,
  ManagedAgentView,
  ProviderType,
  ProviderView,
} from '@voxel/shared';
import { voiceApi } from './local-recorder';
import { readAgentResponse } from './agent-response';
import { VoicePanel } from './VoicePanel';

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
const taskStatusNames: Record<AgentTaskStatus, string> = {
  running: '执行任务',
  waiting: '等待环境变化',
  needs_input: '等待你的答复',
  blocked: '任务受阻',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  budget: '达到保护上限',
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
  maxTurns: 100,
  tokenBudget: 50000,
  taskTimeoutMs: 900000,
  intervalMs: 3000,
  timeoutMs: 60000,
  maxTokens: 512,
  allowEdits: false,
  voiceReplies: true,
  thinking: 'disabled',
  reasoningEffort: 'high',
};
type ConsoleProps = Omit<
  ComponentProps<typeof VoicePanel>,
  'hidden' | 'onClose'
> & {
  open: boolean;
  initialTab?: 'agents';
  onClose: () => void;
};

export function ControlConsole({
  open,
  initialTab,
  onClose,
  ...voiceProps
}: ConsoleProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'agents' | 'providers' | 'voice'>('agents');
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [jobs, setJobs] = useState<ManagedAgentView[]>([]);
  const [agent, setAgent] = useState(initialAgent);
  const [editingAgent, setEditingAgent] = useState<string>();
  const [showAgentForm, setShowAgentForm] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState(freshProvider());
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [taskEditor, setTaskEditor] = useState<string>();
  const [taskGoal, setTaskGoal] = useState('');
  const modelRequest = useRef<AbortController | null>(null);
  const selected = providers.find((p) => p.id === agent.providerId);
  const editingProvider = providers.find((p) => p.id === editing);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [showAgentForm, tab]);
  const openAgentEditor = (job?: ManagedAgentView) => {
    modelRequest.current?.abort();
    setLoadingModels(false);
    setModels([]);
    setEditingAgent(job?.id);
    setAgent(
      job
        ? { ...job, goal: job.task?.goal ?? job.goal }
        : {
            ...initialAgent,
            providerId: providers[0]?.id ?? '',
            model: providers[0]?.defaultModel ?? '',
          },
    );
    setError('');
    setNotice('');
    setShowAgentForm(true);
  };
  useEffect(() => {
    if (!open) return;
    setLoadingModels(false);
    if (initialTab) {
      setTab(initialTab);
      setShowAgentForm(false);
    }
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
            providerId: a.providerId || list[0].id,
            model: a.providerId ? a.model : list[0].defaultModel,
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
      if (previous?.isConnected) previous.focus();
    };
  }, [open, initialTab]);
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
      id="control-console"
      className="agent-dialog"
      aria-labelledby="agent-title"
      onCancel={onClose}
    >
      <div className="agent-chrome">
        <div className="agent-heading">
          <div>
            <div className="eyebrow">WORLD CONSOLE</div>
            <h2 id="agent-title">控制台</h2>
            <p>管理 AI 伙伴、连接模型服务，设置语音交流。</p>
          </div>
          <button type="button" aria-label="关闭控制台" onClick={onClose}>
            关闭 ×
          </button>
        </div>
        <nav className="agent-tabs" aria-label="控制台分类">
          <button
            aria-pressed={tab === 'agents'}
            onClick={() => {
              setTab('agents');
              setShowAgentForm(false);
              setError('');
              setNotice('');
            }}
          >
            Agent 玩家{' '}
            <small>
              {
                jobs.filter((j) => isActive(j) || j.task?.status === 'running')
                  .length
              }{' '}
              运行中 ·{' '}
              {
                jobs.filter(
                  (j) => j.status === 'idle' && j.task?.status !== 'running',
                ).length
              }{' '}
              待命
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
          <button
            aria-pressed={tab === 'voice'}
            onClick={() => setTab('voice')}
          >
            语音设置
          </button>
        </nav>
      </div>
      <div className="agent-body" ref={body}>
        <div className="console-voice" hidden={tab !== 'voice'}>
          <div className="console-section-heading">
            <h3>语音设置</h3>
            <p>选择识别与朗读方式，在这里试试语音对话。</p>
          </div>
          <div className="console-voice-layout">
            <VoicePanel {...voiceProps} />
            <aside className="console-voice-guide" aria-label="语音使用说明">
              <h4>在世界中交流</h4>
              <p>
                附近语音：进入世界后，在侧边语音面板开启麦克风和收听。声音随距离与朝向变化，附近
                Agent 会收到转写。
              </p>
              <p>
                聊天语音：在聊天框中使用语音转文字或录语音，也可以 @ 玩家与
                Agent 私聊。
              </p>
              <small>
                此处的识别与朗读选项用于语音实验室。切换页面或关闭控制台会保留设置；需要结束录音或朗读时，点击“打断”。
              </small>
            </aside>
          </div>
        </div>
        <div hidden={tab === 'voice'}>
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
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
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
                            const list =
                              await api<ProviderView[]>('/providers');
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
          ) : showAgentForm ? (
            <div className="agent-editor">
              <button
                className="agent-back"
                type="button"
                disabled={busy}
                onClick={() => {
                  setShowAgentForm(false);
                  setError('');
                  setNotice('');
                }}
              >
                ‹ 返回 Agent 列表
              </button>
              <form
                className="agent-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () => {
                    const saved = await api<ManagedAgentView>(
                      editingAgent
                        ? `/${encodeURIComponent(editingAgent)}`
                        : '',
                      editingAgent ? 'PUT' : 'POST',
                      {
                        ...agent,
                        intervalMs:
                          editingAgent || agent.intervalMode === 'fixed'
                            ? agent.intervalMs
                            : 3000,
                        intervalMinMs:
                          editingAgent || agent.intervalMode === 'random'
                            ? agent.intervalMinMs
                            : 4000,
                        intervalMaxMs:
                          editingAgent || agent.intervalMode === 'random'
                            ? agent.intervalMaxMs
                            : 8000,
                      },
                    );
                    setJobs(await api<ManagedAgentView[]>(''));
                    if (editingAgent) setAgent(saved);
                    setShowAgentForm(false);
                    setNotice(
                      editingAgent
                        ? '参数已保存。任务修改后请点击继续任务；普通消息只处理一次。'
                        : 'Agent 已开始加入世界。关闭面板后仍会继续运行。',
                    );
                  });
                }}
              >
                <h3>{editingAgent ? '修改 Agent 参数' : '创建 Agent 玩家'}</h3>
                {editingAgent && (
                  <p className="agent-hint">
                    保存不会启动任务，角色与位置保留。运行中的 Agent
                    请先暂停任务再修改。
                  </p>
                )}
                <fieldset disabled={busy}>
                  <h4 className="agent-section-title">基本信息</h4>
                  <div className="agent-grid">
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
                  </div>
                  <button
                    className="agent-model-test"
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
                      onChange={(e) =>
                        setAgent({ ...agent, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    任务目标
                    <textarea
                      required
                      rows={3}
                      maxLength={2000}
                      value={agent.goal}
                      onChange={(e) =>
                        setAgent({ ...agent, goal: e.target.value })
                      }
                    />
                    <small className="agent-hint">
                      填写希望 Agent
                      完成的目标；具体方案和执行情况会显示在卡片的“最近执行进展”中。
                    </small>
                  </label>
                  <h4 className="agent-section-title">运行安排</h4>
                  <p className="agent-hint">
                    任务按实际进展继续，完成、受阻或需要确认时自动停下；达到保护预算也会暂停。普通聊天只回复一次。
                  </p>
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
                      唤醒间隔（毫秒）
                      <input
                        type="number"
                        min={1000}
                        max={60000}
                        required
                        value={
                          Number.isNaN(agent.intervalMs) ? '' : agent.intervalMs
                        }
                        onChange={(e) =>
                          setAgent({
                            ...agent,
                            intervalMs: e.target.valueAsNumber,
                          })
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
                    每次间隔只推进一次决策。等待期间先在本地检查环境，空闲或条件未变时不调用模型。新消息及时唤醒，同一
                    Agent 不并发推理。
                  </p>
                  <details>
                    <summary>高级参数 · 预算保护与推理</summary>
                    <p className="agent-hint">
                      以下为异常保护上限，不是要求执行的轮数。达到上限会暂停，手动继续才会开启新的预算额度。
                    </p>
                    <div className="agent-grid">
                      <label>
                        任务调用上限
                        <input
                          type="number"
                          min={1}
                          max={200}
                          required
                          value={agent.maxTurns}
                          onChange={(e) =>
                            setAgent({
                              ...agent,
                              maxTurns: e.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label>
                        任务 token 预算
                        <input
                          type="number"
                          min={1000}
                          max={1000000}
                          required
                          value={agent.tokenBudget ?? 50000}
                          onChange={(e) =>
                            setAgent({
                              ...agent,
                              tokenBudget: e.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label>
                        任务执行时间上限（分钟）
                        <input
                          type="number"
                          min={1}
                          max={120}
                          required
                          value={(agent.taskTimeoutMs ?? 900000) / 60000}
                          onChange={(e) =>
                            setAgent({
                              ...agent,
                              taskTimeoutMs: e.target.valueAsNumber * 60000,
                            })
                          }
                        />
                      </label>
                    </div>
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
                  <label className="agent-check">
                    <input
                      type="checkbox"
                      checked={!!agent.voiceReplies}
                      onChange={(e) =>
                        setAgent({ ...agent, voiceReplies: e.target.checked })
                      }
                    />
                    语音回复（附近玩家可听见）
                  </label>
                  <p className="agent-hint">
                    使用服务器本机语音合成；私聊仅指定接收者可听，玩家需开启附近语音收听。
                  </p>
                  <p className="agent-hint">
                    {editingAgent
                      ? '保存后保持当前状态，下次运行使用新参数。'
                      : '创建后加入世界并开始任务。'}
                    云端模型按服务商规则计费。
                  </p>
                  <div className="agent-editor-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAgentForm(false);
                        setError('');
                        setNotice('');
                      }}
                    >
                      取消
                    </button>
                    <button
                      className="primary"
                      disabled={
                        !selected ||
                        (selected.type !== 'ollama' && !selected.hasApiKey)
                      }
                    >
                      {busy
                        ? '处理中…'
                        : editingAgent
                          ? '保存参数'
                          : '创建并加入世界'}
                    </button>
                  </div>
                </fieldset>
              </form>
            </div>
          ) : (
            <section className="agent-runs" aria-label="Agent 运行状态">
              <div className="agent-list-heading">
                <div>
                  <h3>我的 Agent</h3>
                  <p className="agent-hint">
                    {jobs.filter((j) => j.sessionId || isActive(j)).length} / 4
                    在线 · 待命时可通过 @ 唤醒
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => openAgentEditor()}
                >
                  ＋ 创建 Agent
                </button>
              </div>
              {pollError && (
                <p role="alert" className="agent-error">
                  {pollError}
                </p>
              )}
              {!jobs.length && (
                <div className="agent-empty">
                  还没有 Agent 玩家
                  <br />
                  <small>创建一位 AI 伙伴，一起探索与搭建。</small>
                </div>
              )}
              <div className="agent-job-list">
                {jobs.map((job) => (
                  <article
                    className="agent-job"
                    key={job.id}
                    data-task-status={job.task?.status}
                  >
                    <div className="agent-job-title">
                      <div className="agent-identity">
                        <span className="agent-avatar" aria-hidden="true">
                          {job.name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>{job.name}</strong>
                          <p className="agent-job-model">
                            {job.providerName} · {job.model}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`agent-badge ${isActive(job) ? 'active' : ''}`}
                      >
                        {job.status === 'idle' && job.task
                          ? taskStatusNames[job.task.status]
                          : statusNames[job.status]}
                      </span>
                    </div>
                    <p className="agent-job-goal">
                      <span className="agent-detail-label">任务目标</span>
                      {job.task?.goal ?? job.goal}
                    </p>
                    {job.task && (
                      <div className="agent-task-progress">
                        <p>
                          <span className="agent-detail-label">最近进展</span>
                          {job.task.summary}
                        </p>
                        {job.task.reason &&
                          job.task.reason !== job.task.summary && (
                            <p className="agent-task-notice">
                              <span aria-hidden="true">●</span>{' '}
                              {job.task.reason}
                            </p>
                          )}
                      </div>
                    )}
                    <div className="agent-card-actions">
                      {!isActive(job) && job.task?.status !== 'running' && (
                        <button
                          className="primary"
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
                          {job.task?.status === 'budget'
                            ? '确认追加预算并继续'
                            : job.sessionId
                              ? ['completed', 'cancelled'].includes(
                                  job.task?.status ?? '',
                                )
                                ? '重新执行任务'
                                : '继续任务'
                              : '重新加入并执行'}
                        </button>
                      )}
                      {job.sessionId &&
                        !['joining', 'stopping'].includes(job.status) && (
                          <>
                            {['running', 'waiting'].includes(
                              job.task?.status ?? '',
                            ) && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void perform(async () => {
                                    await api(
                                      `/${encodeURIComponent(job.id)}/pause`,
                                      'POST',
                                      {},
                                    );
                                    setJobs(await api<ManagedAgentView[]>(''));
                                  })
                                }
                              >
                                暂停任务
                              </button>
                            )}
                            {!['completed', 'cancelled'].includes(
                              job.task?.status ?? '',
                            ) && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void perform(async () => {
                                    await api(
                                      `/${encodeURIComponent(job.id)}/cancel`,
                                      'POST',
                                      {},
                                    );
                                    setJobs(await api<ManagedAgentView[]>(''));
                                  })
                                }
                              >
                                取消任务
                              </button>
                            )}
                          </>
                        )}
                      <button
                        disabled={
                          busy || ['joining', 'stopping'].includes(job.status)
                        }
                        onClick={() => {
                          setTaskEditor(
                            taskEditor === job.id ? undefined : job.id,
                          );
                          setTaskGoal('');
                        }}
                      >
                        布置新任务
                      </button>
                      <button
                        disabled={
                          busy ||
                          isActive(job) ||
                          job.task?.status === 'running'
                        }
                        title={isActive(job) ? '请先暂停任务再编辑' : undefined}
                        onClick={() => openAgentEditor(job)}
                      >
                        编辑参数
                      </button>
                      {(isActive(job) ||
                        job.sessionId ||
                        job.status === 'idle' ||
                        job.status === 'failed') && (
                        <button
                          className="agent-close-action"
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
                    </div>
                    {taskEditor === job.id && (
                      <form
                        className="agent-task-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void perform(async () => {
                            await api(
                              `/${encodeURIComponent(job.id)}/task`,
                              'POST',
                              { goal: taskGoal },
                            );
                            setJobs(await api<ManagedAgentView[]>(''));
                            setTaskEditor(undefined);
                          });
                        }}
                      >
                        <label>
                          新任务
                          <textarea
                            required
                            rows={3}
                            maxLength={2000}
                            value={taskGoal}
                            onChange={(e) => setTaskGoal(e.target.value)}
                            placeholder="例如：在东侧空地建一间木屋，门朝南"
                          />
                        </label>
                        <p className="agent-hint">
                          提交后替换当前任务；角色和已完成的建筑保留。
                        </p>
                        <div className="agent-card-actions">
                          <button
                            className="primary"
                            disabled={busy || !taskGoal.trim()}
                          >
                            开始任务
                          </button>
                          <button
                            type="button"
                            onClick={() => setTaskEditor(undefined)}
                          >
                            返回
                          </button>
                        </div>
                      </form>
                    )}
                    <details className="agent-card-details">
                      <summary>
                        用量与配置{' '}
                        <span>
                          {job.task
                            ? `${job.task.calls} / ${job.maxTurns} 次调用`
                            : '查看详情'}
                        </span>
                      </summary>
                      {job.task && (
                        <p className="agent-hint">
                          本额度 {job.task.calls} / {job.maxTurns} 次调用 ·{' '}
                          {job.task.estimated ? '约 ' : ''}
                          {job.task.tokens.toLocaleString()} tokens
                        </p>
                      )}
                      {job.usage && (
                        <p className="agent-hint">
                          累计 {job.usage.calls} 次调用 ·{' '}
                          {job.usage.estimated ? '约 ' : ''}
                          {job.usage.tokens.toLocaleString()} tokens
                        </p>
                      )}
                      <div className="agent-job-meta">
                        <span>任务驱动</span>
                        <span>
                          {job.intervalMode === 'random'
                            ? `随机 ${job.intervalMinMs}–${job.intervalMaxMs} ms`
                            : `间隔 ${job.intervalMs} ms`}
                        </span>
                        <span>
                          {job.allowEdits ? '允许建造' : '仅探索与交流'} ·{' '}
                          {job.voiceReplies ? '语音回复开启' : '语音回复关闭'}
                        </span>
                      </div>
                      <button
                        disabled={
                          busy || ['joining', 'stopping'].includes(job.status)
                        }
                        aria-pressed={!!job.voiceReplies}
                        onClick={() =>
                          void perform(async () => {
                            await api(
                              `/${encodeURIComponent(job.id)}/voice`,
                              'POST',
                              { enabled: !job.voiceReplies },
                            );
                            setJobs(await api<ManagedAgentView[]>(''));
                          })
                        }
                      >
                        {job.voiceReplies ? '关闭语音回复' : '开启语音回复'}
                      </button>
                    </details>
                    <details className="agent-run-log">
                      <summary>运行记录</summary>
                      {job.lastResponse && (
                        <p className="agent-hint">
                          最近处理结果：{job.lastResponse}
                        </p>
                      )}
                      <pre>{job.logs.join('\n') || '暂无运行记录'}</pre>
                    </details>
                  </article>
                ))}
              </div>
              <p className="agent-list-note">
                关闭控制台不会停止 Agent。暂停或取消任务后角色仍在线；私聊和 @
                可交流或安排任务。
              </p>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
