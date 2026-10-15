import {describe,it,expect,vi,afterEach} from 'vitest';
import {MockVoiceProvider,type VoiceEvent} from '../apps/server/src/voice';
afterEach(()=>vi.useRealTimers());
describe('replaceable mock voice session',()=>{
 it('streams labelled subtitles and states',()=>{vi.useFakeTimers();const events:VoiceEvent[]=[];const s=new MockVoiceProvider().create(e=>events.push(e));s.push({kind:'text',text:'hello'});vi.runAllTimers();expect(events.map(e=>e.state)).toEqual(['listening','thinking','speaking','speaking','idle']);expect(events.at(-1)?.subtitle).toContain('not AI');s.close();});
 it('interrupts without late subtitles and isolates sessions',()=>{vi.useFakeTimers();const a:VoiceEvent[]=[],b:VoiceEvent[]=[];const provider=new MockVoiceProvider(),s1=provider.create(e=>a.push(e)),s2=provider.create(e=>b.push(e));s1.push({kind:'text',text:'one'});s2.push({kind:'text',text:'two'});vi.advanceTimersByTime(500);s1.interrupt();vi.runAllTimers();expect(a.at(-1)?.state).toBe('interrupted');expect(b.at(-1)?.state).toBe('idle');});
 it('rejects audio honestly and cancels on close',()=>{vi.useFakeTimers();const events:VoiceEvent[]=[];const s=new MockVoiceProvider().create(e=>events.push(e));s.push({kind:'audio',pcm:new Uint8Array(10),sampleRate:16000});expect(events.at(-1)?.error).toBe('mock-does-not-process-audio');s.push({kind:'text',text:'bye'});s.close();vi.runAllTimers();expect(events).toHaveLength(2);});
});
