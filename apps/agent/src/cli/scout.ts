import { Session, delay } from '@voxel/agent-runtime';
let agent: Session | undefined,
  closing = false;
console.log(
  'SCRIPTED TEST AGENT — deterministic script, not AI. Ctrl+C to leave.',
);
process.on('SIGINT', () => {
  closing = true;
  agent?.room.connection.close();
  process.exit(0);
});
while (!closing) {
  try {
    if (!agent) {
      agent = await new Session().join('Scout · scripted test');
      await agent.request('chat', {
        text: 'Scout is a scripted test agent (not AI). Observing the local scene.',
      });
    }
    const o = await agent.observe();
    console.log(
      JSON.stringify({
        revision: o.revision,
        nearbyPlayers: o.players.length,
        visibleBlocks: o.blocks.length,
        self: o.self,
      }),
    );
    await delay(3000);
  } catch (error) {
    console.error('Agent disconnected; retrying:', String(error));
    if (agent) {
      try {
        await agent.reconnect();
        continue;
      } catch {
        agent.room.connection.close();
        agent = undefined;
      }
    }
    await delay(2000);
  }
}
