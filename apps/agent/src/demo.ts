import { Session, delay } from './session';
const agent=await new Session().join('Scout · scripted test');
console.log('SCRIPTED TEST AGENT — deterministic script, not AI. Ctrl+C to leave.');
await agent.request('chat',{text:'I am Scout, a scripted test agent (not AI). I can observe, move and validate actions.'});
let closing=false;
process.on('SIGINT',()=>{closing=true;void agent.close().then(()=>process.exit(0));});
while(!closing){const o=await agent.observe();console.log(JSON.stringify({revision:o.revision,nearbyPlayers:o.players.length,visibleBlocks:o.blocks.length,self:o.self}));await delay(3000);}
