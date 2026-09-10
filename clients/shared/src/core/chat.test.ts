import { describe, expect, it } from 'vitest';
import { appendUserMessage, initialChatState, reduceChat } from './chat';
import type { ServerEvent } from '@triforce/protocol';

const ev = (e: Partial<ServerEvent> & { type: string }) => e as ServerEvent;

describe('reduceChat', () => {
  it('captures the conversation id and streams a full verified turn', () => {
    let s = initialChatState();
    s = appendUserMessage(s, 'How do I do X?');
    expect(s.messages).toEqual([{ role: 'user', text: 'How do I do X?' }]);
    expect(s.status).toBe('thinking');

    s = reduceChat(s, ev({ type: 'run_started', conversationId: 'c-1' }));
    expect(s.conversationId).toBe('c-1');

    s = reduceChat(s, ev({ type: 'chat_message', role: 'draft', cli: 'claude-cli', text: 'draft answer' }));
    s = reduceChat(s, ev({ type: 'chat_message', role: 'check', cli: 'codex-cli', assessment: 'AGREE', text: 'ok' }));
    s = reduceChat(s, ev({ type: 'deliberation', agreement: '2 of 3', crossChecked: true }));
    s = reduceChat(s, ev({ type: 'chat_message', role: 'final', cli: 'agy-cli', text: 'final answer' }));
    s = reduceChat(s, ev({ type: 'done', passed: true }));

    expect(s.messages.map(m => m.role)).toEqual(['user', 'draft', 'check', 'final']);
    expect(s.messages.at(-1)).toMatchObject({ role: 'final', cli: 'agy-cli', text: 'final answer' });
    expect(s.lastAgreement).toBe('2 of 3');
    expect(s.crossChecked).toBe(true);
    expect(s.status).toBe('done');
  });

  it('surfaces an error and ignores echoed user messages', () => {
    let s = reduceChat(initialChatState(), ev({ type: 'chat_message', role: 'user', text: 'echo' }));
    expect(s.messages).toEqual([]);
    s = reduceChat(s, ev({ type: 'error', message: 'every CLI failed' }));
    expect(s.status).toBe('error');
    expect(s.label).toBe('every CLI failed');
  });

  it('keeps prior messages across turns (a new run_started does not clear history)', () => {
    let s = appendUserMessage(initialChatState(), 'first');
    s = reduceChat(s, ev({ type: 'chat_message', role: 'final', text: 'a1' }));
    s = reduceChat(s, ev({ type: 'done' }));
    s = appendUserMessage(s, 'second');
    s = reduceChat(s, ev({ type: 'run_started', conversationId: 'c-1' }));
    expect(s.messages.map(m => m.text)).toEqual(['first', 'a1', 'second']);
  });
});
