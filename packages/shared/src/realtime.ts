import type { Edit } from './index';
export type RealtimeEvent = {
  session: string;
  request?: string;
  kind:
    | 'ready'
    | 'subtitle'
    | 'audio'
    | 'proposal'
    | 'done'
    | 'closed'
    | 'error';
  demo: boolean;
  text?: string;
  audio?: string;
  proposal?: { id: string; edit: Edit };
};
export const REALTIME_LIMITS = {
  inputChunk: 6400,
  inputBytes: 16000 * 2 * 15,
  outputBytes: 24000 * 2 * 30,
  sessionMs: 120000,
};
