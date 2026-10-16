import assert from 'node:assert/strict';
import { Session, delay, until } from '@voxel/agent-runtime';
const a = await new Session().join('Test-A', 'human'),
  b = await new Session().join('Test-B', 'human'),
  agent = await new Session().join('Validator · scripted test');
const tests: string[] = [];
try {
  await until(() => a.room.state.players.size >= 3);
  tests.push('three simultaneous clients and schema sync');
  let o = await agent.observe();
  assert(o.players.some((p) => p.kind === 'scripted-agent'));
  assert(o.blocks.length <= 500);
  assert.equal(o.radius, 8);
  tests.push('structured local observation');
  assert.equal(
    (await agent.request('teleport', { x: 100 })).error,
    'unknown-action',
  );
  assert.equal(
    (await agent.request('move', { x: 100, z: 0, yaw: 0, jump: false })).error,
    'invalid-input',
  );
  assert.equal(
    (
      await agent.request('edit', {
        x: 0,
        y: 0,
        z: 0,
        material: null,
        revision: o.revision,
      })
    ).error,
    'bounds',
  );
  assert.equal(
    (
      await agent.request('edit', {
        x: 12,
        y: 15,
        z: 12,
        material: 'wood',
        revision: o.revision,
      })
    ).error,
    'out-of-reach',
  );
  tests.push(
    'action whitelist, malformed movement, bedrock and reach validation',
  );
  const cell = { x: 2, y: 3, z: 1 };
  o = await a.observe();
  if (
    o.blocks.some((v) => v.x === cell.x && v.y === cell.y && v.z === cell.z)
  ) {
    assert.equal(
      (
        await a.request('edit', {
          ...cell,
          material: null,
          revision: o.revision,
        })
      ).ok,
      true,
    );
    o = await a.observe();
  }
  const [r1, r2] = await Promise.all([
    a.request('edit', { ...cell, material: 'wood', revision: o.revision }),
    b.request('edit', { ...cell, material: 'stone', revision: o.revision }),
  ]);
  assert.equal(Number(r1.ok) + Number(r2.ok), 1);
  assert.equal((r1.ok ? r2 : r1).error, 'conflict');
  await until(
    () =>
      a.edits.some((e) => e.revision === o.revision + 1) &&
      b.edits.some((e) => e.revision === o.revision + 1) &&
      agent.edits.some((e) => e.revision === o.revision + 1),
  );
  tests.push('concurrent edit CAS and broadcast to all three clients');
  await a.request('chat', { text: 'integration hello' });
  await until(() =>
    agent.events.some(
      (e) =>
        e.type === 'chat' &&
        (e.data as { text: string }).text === 'integration hello',
    ),
  );
  tests.push('chat broadcast');
  const id = a.room.sessionId;
  await a.reconnect();
  assert.equal(a.room.sessionId, id);
  assert.equal((await a.observe()).self.connected, true);
  tests.push('abnormal socket reconnect preserves identity');
  const fresh = await new Session().join('Refresh test', 'human');
  try {
    assert(
      fresh.snapshot?.blocks.some(
        (v) => v.x === cell.x && v.y === cell.y && v.z === cell.z,
      ),
    );
    assert.equal(fresh.snapshot?.persistence, 'postgresql');
  } finally {
    await fresh.close();
  }
  tests.push('new session loads saved edit from authoritative world');
  await agent.request('voice.start', { text: 'test subtitles' });
  await until(() =>
    agent.voice.some((v) => (v as { state: string }).state === 'speaking'),
  );
  await agent.request('voice.interrupt');
  await delay(1500);
  assert.equal((agent.voice.at(-1) as { state: string }).state, 'interrupted');
  assert.equal(a.voice.length, 0);
  tests.push('voice subtitles, interruption and per-client privacy');
  const start = (await agent.observe()).self;
  for (let i = 0; i < 8; i++) {
    agent.move(0, -1);
    await delay(55);
  }
  agent.move(0, 0);
  const moved = (await agent.observe()).self;
  assert(Math.abs(moved.z - start.z) > 0.5);
  assert(Math.abs(moved.z - start.z) < 2.5);
  tests.push('authoritative movement bounded by speed');
  o = await a.observe();
  assert.equal(
    (await a.request('edit', { ...cell, material: null, revision: o.revision }))
      .ok,
    true,
  );
  console.log(JSON.stringify({ passed: tests.length, tests }, null, 2));
} finally {
  await Promise.all([a.close(), b.close(), agent.close()]);
}
