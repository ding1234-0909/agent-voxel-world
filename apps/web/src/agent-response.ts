export async function readAgentResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw Error(
      response.status === 404
        ? 'Agent 接口不可用，请确认后端已更新并重启后重试。'
        : `Agent 服务响应异常（HTTP ${response.status}），请稍后重试。`,
    );
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? data.error
        : undefined;
    throw Error(
      typeof message === 'string' ? message : '请求失败，请稍后重试。',
    );
  }
  return data as T;
}
