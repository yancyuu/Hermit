import { describe, expect, it } from 'vitest';

import {
  normalizeCursorStreamJson,
  summarizeCursorRuntimeEvents,
} from '../../../../src/features/cursor-runtime';

describe('cursor stream-json normalization', () => {
  it('normalizes Cursor headless stream-json events into Hermit runtime events', () => {
    const stdout = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'cursor-session-1',
        cwd: '/repo',
        model: 'GPT-5.4 1M',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
        },
        session_id: 'cursor-session-1',
        timestamp_ms: 1777723383498,
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'final answer',
        session_id: 'cursor-session-1',
      }),
    ].join('\n');

    const events = normalizeCursorStreamJson(stdout);

    expect(events).toEqual([
      expect.objectContaining({
        type: 'session',
        sessionId: 'cursor-session-1',
        rawType: 'system',
        rawSubtype: 'init',
      }),
      expect.objectContaining({
        type: 'assistant',
        sessionId: 'cursor-session-1',
        text: 'done',
        timestampMs: 1777723383498,
      }),
      expect.objectContaining({
        type: 'result',
        sessionId: 'cursor-session-1',
        text: 'final answer',
      }),
    ]);
    expect(summarizeCursorRuntimeEvents(events)).toEqual({
      sessionId: 'cursor-session-1',
      resultText: 'final answer',
      diagnostics: [],
    });
  });

  it('keeps connection and retry events as diagnostics without hiding the answer', () => {
    const stdout = [
      JSON.stringify({
        type: 'connection',
        subtype: 'reconnecting',
        session_id: 'cursor-session-2',
      }),
      JSON.stringify({
        type: 'retry',
        subtype: 'starting',
        session_id: 'cursor-session-2',
        attempt: 1,
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'answer after reconnect' }],
        },
        session_id: 'cursor-session-2',
      }),
    ].join('\n');

    const summary = summarizeCursorRuntimeEvents(normalizeCursorStreamJson(stdout));

    expect(summary).toEqual({
      sessionId: 'cursor-session-2',
      resultText: 'answer after reconnect',
      diagnostics: ['connection:reconnecting', 'retry:starting'],
    });
  });

  it('surfaces non-json lines as raw parse diagnostics', () => {
    const summary = summarizeCursorRuntimeEvents(normalizeCursorStreamJson('not-json\n'));

    expect(summary).toEqual({
      sessionId: null,
      resultText: '',
      diagnostics: ['unparsed:not-json'],
    });
  });
});
