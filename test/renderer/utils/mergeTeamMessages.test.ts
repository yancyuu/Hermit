import { describe, expect, it } from 'vitest';

import { mergeTeamMessages } from '../../../src/renderer/utils/mergeTeamMessages';

import type { InboxMessage } from '@shared/types';

function makeMessage(
  overrides: Partial<InboxMessage> & Pick<InboxMessage, 'from' | 'text' | 'timestamp'>
): InboxMessage {
  const { from, text, timestamp, ...rest } = overrides;
  return {
    from,
    text,
    timestamp,
    read: rest.read ?? true,
    ...rest,
  };
}

describe('mergeTeamMessages', () => {
  it('deduplicates by stable message key and keeps newest-first order', () => {
    const older = makeMessage({
      from: 'alice',
      text: 'older',
      timestamp: '2026-01-01T00:00:00.000Z',
      messageId: 'm1',
    });
    const newer = makeMessage({
      from: 'bob',
      text: 'newer',
      timestamp: '2026-01-01T00:00:01.000Z',
      messageId: 'm2',
    });
    const merged = mergeTeamMessages([older], [newer]);

    expect(merged.map((message) => message.messageId)).toEqual(['m2', 'm1']);
  });

  it('lets later arrays overlay duplicate messages', () => {
    const persisted = makeMessage({
      from: 'team-lead',
      text: 'hello',
      timestamp: '2026-01-01T00:00:00.000Z',
      messageId: 'm1',
      summary: 'persisted',
    });
    const live = makeMessage({
      from: 'team-lead',
      text: 'hello',
      timestamp: '2026-01-01T00:00:00.000Z',
      messageId: 'm1',
      summary: 'live',
      source: 'lead_process',
    });

    const merged = mergeTeamMessages([persisted], [live]);

    expect(merged).toHaveLength(1);
    expect(merged[0].summary).toBe('live');
    expect(merged[0].source).toBe('lead_process');
  });
});
