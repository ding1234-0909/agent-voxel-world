import { describe, expect, it } from 'vitest';
import { readAgentResponse } from '../apps/web/src/agent-response';

describe('Agent API responses', () => {
  it('explains an unavailable endpoint instead of exposing HTML parsing errors', async () => {
    await expect(
      readAgentResponse(new Response('<!DOCTYPE html>', { status: 404 })),
    ).rejects.toThrow('后端已更新并重启');
  });
  it('handles non-JSON gateway failures and preserves JSON server errors', async () => {
    await expect(
      readAgentResponse(
        new Response('<html>Bad gateway</html>', { status: 502 }),
      ),
    ).rejects.toThrow('HTTP 502');
    await expect(
      readAgentResponse(
        Response.json({ error: 'Agent 正在运行。' }, { status: 409 }),
      ),
    ).rejects.toThrow('Agent 正在运行。');
  });
  it('reads successful JSON and empty responses', async () => {
    await expect(
      readAgentResponse(Response.json({ status: 'idle' })),
    ).resolves.toEqual({ status: 'idle' });
    await expect(
      readAgentResponse(new Response(null, { status: 204 })),
    ).resolves.toBeUndefined();
  });
});
