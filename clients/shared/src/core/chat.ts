import type { ServerEvent } from '@triforce/protocol';

export type ChatRole = 'user' | 'draft' | 'check' | 'final' | 'system';

export interface ChatEntry {
  role: ChatRole;
  cli?: string;
  assessment?: string;
  text: string;
}

export interface ChatState {
  conversationId: string | null;
  messages: ChatEntry[];
  status: 'idle' | 'thinking' | 'done' | 'error';
  label: string;
  lastAgreement: string | null;
  crossChecked: boolean | null;
}

export function initialChatState(): ChatState {
  return { conversationId: null, messages: [], status: 'idle', label: '', lastAgreement: null, crossChecked: null };
}

/** Optimistically record the message the user just sent. */
export function appendUserMessage(state: ChatState, text: string): ChatState {
  return { ...state, messages: [...state.messages, { role: 'user', text }], status: 'thinking', label: '' };
}

export function reduceChat(state: ChatState, event: ServerEvent): ChatState {
  switch (event.type) {
    case 'run_started':
      return { ...state, conversationId: typeof event.conversationId === 'string' ? event.conversationId : state.conversationId, status: 'thinking' };
    case 'status':
      return { ...state, label: String(event.label ?? '') };
    case 'chat_message': {
      const role = event.role as ChatRole;
      if (role === 'user') return state; // user turns are added optimistically
      return {
        ...state,
        messages: [...state.messages, {
          role: role ?? 'system',
          cli: typeof event.cli === 'string' ? event.cli : undefined,
          assessment: typeof event.assessment === 'string' ? event.assessment : undefined,
          text: String(event.text ?? ''),
        }],
      };
    }
    case 'deliberation':
      return {
        ...state,
        lastAgreement: typeof event.agreement === 'string' ? event.agreement : state.lastAgreement,
        crossChecked: typeof event.crossChecked === 'boolean' ? event.crossChecked : state.crossChecked,
      };
    case 'error':
      return { ...state, status: 'error', label: String(event.message ?? 'chat failed') };
    case 'done':
      return { ...state, status: 'done', label: '' };
    case 'run_state':
      return ['completed', 'failed', 'cancelled'].includes(String(event.status ?? ''))
        ? { ...state, status: state.status === 'error' ? 'error' : 'done', label: '' }
        : state;
    default:
      return state;
  }
}
