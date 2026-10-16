import { expect, it } from 'vitest';
import { AgentAttention } from '../apps/agent/src/attention';
import { agentChatContext } from '../apps/agent/src/deepseek';
import type { Observation } from '../apps/agent/src/session';
import type { WorldEvent } from '../packages/shared/src/index';
const message = (
  seq: number,
  scope = 'public',
  recipients = ['ai'],
): WorldEvent => ({
  seq,
  actorKind: 'human',
  actor: 'person',
  type: 'chat',
  at: 0,
  data: { scope, recipients, kind: 'text', text: 'hi', name: 'Person' },
});
it('wakes a long interval promptly, deduplicates, and only accepts addressed human chat', async () => {
  const inbox = new AgentAttention(),
    abort = new AbortController();
  const wait = inbox.wait(60000, abort.signal);
  expect(inbox.push(message(1, 'public', []), 'ai')).toBe(false);
  expect(inbox.push(message(2, 'private', ['other']), 'ai')).toBe(false);
  expect(inbox.push(message(3, 'nearby', ['other']), 'ai')).toBe(false);
  expect(inbox.push(message(4), 'ai')).toBe(true);
  await wait;
  expect(inbox.push(message(4), 'ai')).toBe(false);
  expect(inbox.take()?.seq).toBe(4);
  expect(inbox.pending).toBe(false);
  const next = inbox.wait(60000, abort.signal);
  abort.abort();
  await next;
});
it('bounds queued mentions and keeps private audiences separate when prioritizing a message', () => {
  const inbox = new AgentAttention();
  for (let seq = 1; seq <= 10; seq++) inbox.push(message(seq), 'ai');
  expect(inbox.take()?.seq).toBe(3);
  inbox.clear();
  expect(inbox.pending).toBe(false);
  const secret = message(1, 'private'),
    publicMessage = message(2);
  const raw = {
    self: { id: 'ai' },
    events: [secret, publicMessage],
  } as Observation;
  expect(agentChatContext(raw).events).toEqual([publicMessage]);
  const secondSecret = { ...message(3, 'private'), actor: 'other' };
  raw.events = [secret, secondSecret, publicMessage, secret];
  expect(agentChatContext(raw).events).not.toContainEqual(secondSecret);
});
