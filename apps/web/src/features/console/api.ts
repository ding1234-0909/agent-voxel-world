import type {
  AgentSettings,
  ManagedAgentView,
  ProviderView,
  VoiceServiceView,
  VoiceServiceDraft,
} from '@voxel/shared';
import { serverHttpUrl } from '../../network/endpoints';
import { readAgentResponse } from './agent-response';
import type { ProviderDraft } from './model';

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${serverHttpUrl()}/agents${path}`, {
    method,
    signal,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readAgentResponse<T>(response);
}

const agentPath = (id: string) => `/${encodeURIComponent(id)}`;
const providerPath = (id: string) => `/providers/${encodeURIComponent(id)}`;

export const consoleApi = {
  listVoiceServices: (signal?: AbortSignal) =>
    request<VoiceServiceView[]>('/voice-services', 'GET', undefined, signal),
  saveVoiceService: (draft: VoiceServiceDraft, id?: string) =>
    request<VoiceServiceView>(
      id ? `/voice-services/${encodeURIComponent(id)}` : '/voice-services',
      id ? 'PUT' : 'POST',
      draft,
    ),
  deleteVoiceService: (id: string) =>
    request<void>(`/voice-services/${encodeURIComponent(id)}`, 'DELETE'),
  previewVoice: async (id: string, text: string, signal: AbortSignal) => {
    const response = await fetch(
      `${serverHttpUrl()}/agents/voice-services/${encodeURIComponent(id)}/preview`,
      {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    );
    if (!response.ok) await readAgentResponse(response);
    if (!response.headers.get('content-type')?.startsWith('audio/wav'))
      throw Error('语音服务未返回可播放的音频。');
    return response.blob();
  },
  listProviders: (signal?: AbortSignal) =>
    request<ProviderView[]>('/providers', 'GET', undefined, signal),
  listAgents: (signal?: AbortSignal) =>
    request<ManagedAgentView[]>('', 'GET', undefined, signal),
  listModels: (id: string, signal?: AbortSignal) =>
    request<{ models: string[] }>(
      `${providerPath(id)}/models`,
      'GET',
      undefined,
      signal,
    ),
  saveProvider: (draft: ProviderDraft, id?: string) =>
    request<ProviderView>(
      id ? providerPath(id) : '/providers',
      id ? 'PUT' : 'POST',
      draft,
    ),
  deleteProvider: (id: string) => request<void>(providerPath(id), 'DELETE'),
  saveAgent: (settings: AgentSettings, id?: string) =>
    request<ManagedAgentView>(
      id ? agentPath(id) : '',
      id ? 'PUT' : 'POST',
      settings,
    ),
  resumeAgent: (id: string) =>
    request<void>(`${agentPath(id)}/resume`, 'POST', {}),
  pauseAgent: (id: string) =>
    request<void>(`${agentPath(id)}/pause`, 'POST', {}),
  cancelTask: (id: string) =>
    request<void>(`${agentPath(id)}/cancel`, 'POST', {}),
  stopAgent: (id: string) => request<void>(`${agentPath(id)}/stop`, 'POST', {}),
  assignTask: (id: string, goal: string) =>
    request<void>(`${agentPath(id)}/task`, 'POST', { goal }),
  setVoiceReplies: (id: string, enabled: boolean) =>
    request<void>(`${agentPath(id)}/voice`, 'POST', { enabled }),
};
