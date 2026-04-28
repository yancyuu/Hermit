import { toMessageKey } from './teamMessageKey';

import type { InboxMessage } from '@shared/types';

function compareMessages(a: InboxMessage, b: InboxMessage): number {
  const diff = Date.parse(b.timestamp) - Date.parse(a.timestamp);
  if (diff !== 0) return diff;
  return toMessageKey(a).localeCompare(toMessageKey(b));
}

/**
 * Merge multiple message arrays into one newest-first list with stable deduplication.
 *
 * Later arrays win for duplicate keys so callers can overlay fresher/live message data
 * on top of paginated history without losing already-loaded older pages.
 */
export function mergeTeamMessages(...messageLists: readonly InboxMessage[][]): InboxMessage[] {
  const merged = new Map<string, InboxMessage>();

  for (const list of messageLists) {
    for (const message of list) {
      merged.set(toMessageKey(message), message);
    }
  }

  return Array.from(merged.values()).sort(compareMessages);
}
