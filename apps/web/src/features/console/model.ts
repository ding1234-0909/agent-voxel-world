import type {
  AgentSettings,
  AgentTaskStatus,
  ManagedAgentView,
  ProviderType,
  ProviderView,
} from '@voxel/shared';
export const presets = {
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
export const freshProvider = (type: ProviderType = 'compatible') => ({
  ...presets[type],
  type,
  apiKey: '',
  jsonMode: true,
  tokenField: 'max_tokens' as ProviderView['tokenField'],
});
export const statusNames: Record<ManagedAgentView['status'], string> = {
  joining: '加入中',
  running: '运行中',
  idle: '在线待命',
  stopping: '停止中',
  stopped: '已关闭',
  completed: '任务已结束',
  failed: '任务异常',
};
export const taskStatusNames: Record<AgentTaskStatus, string> = {
  running: '执行任务',
  waiting: '等待环境变化',
  needs_input: '等待你的答复',
  blocked: '任务受阻',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  budget: '达到保护上限',
};
export const isActive = (job: ManagedAgentView) =>
  ['joining', 'running', 'stopping'].includes(job.status);
export const initialAgent: AgentSettings = {
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
  voiceReplies: false,
  voiceServiceId: '',
  thinking: 'disabled',
  reasoningEffort: 'high',
};
export type ProviderDraft = ReturnType<typeof freshProvider>;
