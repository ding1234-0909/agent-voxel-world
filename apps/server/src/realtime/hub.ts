import {
  BailianSession,
  type BailianConfig,
  type SceneAccess,
} from './bailian';
import { DemoSocket } from './demo-socket';
import type { RealtimeEvent } from '../../../../packages/shared/src/realtime';
export class RealtimeHub {
  private sessions = new Map<string, BailianSession>();
  private requests = new Map<string, string>();
  constructor(
    private scene: (owner: string) => SceneAccess,
    private emit: (owner: string, event: RealtimeEvent) => void,
    private config: () => BailianConfig = () => ({
      enabled: process.env.BAILIAN_REALTIME_ENABLED === 'true',
      workspace: process.env.BAILIAN_WORKSPACE_ID ?? '',
      model: process.env.BAILIAN_REALTIME_MODEL,
      voice: process.env.BAILIAN_REALTIME_VOICE,
      credential: () => process.env.DASHSCOPE_API_KEY ?? '',
    }),
  ) {}
  handle(owner: string, type: string, payload: any) {
    if (type === 'realtime.start') {
      if (payload?.mode !== 'demo' && payload?.mode !== 'real')
        throw Error('invalid-realtime-mode');
      if (
        typeof payload.request !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(payload.request)
      )
        throw Error('invalid-realtime-request');
      const demo = payload.mode === 'demo';
      if (!demo && payload.audioConsent !== true)
        throw Error('explicit-audio-consent-required');
      this.close(owner);
      const session = new BailianSession(
        demo,
        payload.sceneConsent === true ? this.scene(owner) : undefined,
        (event) => this.emit(owner, { ...event, request: payload.request }),
      );
      this.sessions.set(owner, session);
      this.requests.set(owner, payload.request);
      try {
        session.start(
          demo
            ? { enabled: false, workspace: 'offline', credential: () => '' }
            : this.config(),
          demo ? () => new DemoSocket() : undefined,
        );
      } catch (error) {
        this.close(owner);
        throw error;
      }
      return;
    }
    const session = this.sessions.get(owner);
    if (
      type === 'realtime.stop' &&
      session &&
      typeof payload?.request === 'string' &&
      this.requests.get(owner) === payload.request
    ) {
      this.close(owner);
      return;
    }
    if (!session || payload?.session !== session.id)
      throw Error('invalid-realtime-session');
    if (type === 'realtime.audio') session.audio(payload.audio);
    else if (type === 'realtime.commit') session.commit(payload.text);
    else if (type === 'realtime.stop') this.close(owner);
    else throw Error('unknown-realtime-action');
  }
  approve(owner: string, payload: any) {
    const session = this.sessions.get(owner);
    if (!session || session.id !== payload?.session)
      throw Error('invalid-realtime-session');
    return session.takeProposal(payload.proposalId);
  }
  close(owner: string) {
    this.sessions.get(owner)?.close();
    this.sessions.delete(owner);
    this.requests.delete(owner);
  }
  dispose() {
    for (const owner of this.sessions.keys()) this.close(owner);
  }
}
