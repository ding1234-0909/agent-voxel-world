import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  ManagedAgentView,
  ProviderView,
  VoiceServiceView,
} from '@voxel/shared';
import { consoleApi } from './api';
import { freshProvider, initialAgent } from './model';
export function useConsoleController(open: boolean, initialTab?: 'agents') {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'agents' | 'providers' | 'voice'>('agents');
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [voiceServices, setVoiceServices] = useState<VoiceServiceView[]>([]);
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
    void consoleApi
      .listVoiceServices(abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) setVoiceServices(list);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取语音服务。');
      });
    void consoleApi
      .listProviders(abort.signal)
      .then((list) => {
        if (abort.signal.aborted) return;
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
        const list = await consoleApi.listAgents(abort.signal);
        if (abort.signal.aborted) return;
        setJobs(list);
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
      const result = await consoleApi.listModels(id, abort.signal);
      if (abort.signal.aborted) return;
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
      const saved = await consoleApi.saveProvider(draft, editing);
      setProviders(await consoleApi.listProviders());
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

  const removeProvider = () =>
    perform(async () => {
      if (!editing) return;
      await consoleApi.deleteProvider(editing);
      const list = await consoleApi.listProviders();
      setProviders(list);
      if (agent.providerId === editing)
        setAgent((a) => ({
          ...a,
          providerId: list[0]?.id ?? '',
          model: list[0]?.defaultModel ?? '',
        }));
      editProvider();
      setNotice('服务商已删除。');
    });
  const saveAgent = () =>
    perform(async () => {
      const saved = await consoleApi.saveAgent(
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
        editingAgent,
      );
      setJobs(await consoleApi.listAgents());
      if (editingAgent) setAgent(saved);
      setShowAgentForm(false);
      setNotice(
        editingAgent
          ? '参数已保存。任务修改后请点击继续任务；普通消息只处理一次。'
          : 'Agent 已开始加入世界。关闭面板后仍会继续运行。',
      );
    });
  const resumeAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.resumeAgent(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const pauseAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.pauseAgent(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const cancelTask = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.cancelTask(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const stopAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.stopAgent(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const assignTask = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.assignTask(job.id, taskGoal);
      setJobs(await consoleApi.listAgents());
      setTaskEditor(undefined);
    });
  const toggleVoiceReplies = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.setVoiceReplies(job.id, !job.voiceReplies);
      setJobs(await consoleApi.listAgents());
    });
  return {
    dialog,
    tab,
    setTab,
    providers,
    voiceServices,
    setVoiceServices,
    jobs,
    agent,
    setAgent,
    editingAgent,
    showAgentForm,
    setShowAgentForm,
    body,
    editing,
    draft,
    setDraft,
    models,
    busy,
    loadingModels,
    notice,
    setNotice,
    error,
    setError,
    pollError,
    taskEditor,
    setTaskEditor,
    taskGoal,
    setTaskGoal,
    selected,
    editingProvider,
    openAgentEditor,
    chooseProvider,
    readModels,
    editProvider,
    saveProvider,
    removeProvider,
    saveAgent,
    resumeAgent,
    pauseAgent,
    cancelTask,
    stopAgent,
    assignTask,
    toggleVoiceReplies,
  };
}
export type ConsoleController = ReturnType<typeof useConsoleController>;
