import type {
  AgentSettings,
  ManagedAgentView,
  ProviderView,
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
