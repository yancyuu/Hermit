import type { InboxMessage } from '@shared/types';

const FALLBACK_SLICE = 80;

/**
 * Stable key for a team message. Prefer messageId; otherwise build from timestamp, from, and text.
 */
export function toMessageKey(message: InboxMessage): string {
  if (typeof message.messageId === 'string' && message.messageId.trim().length > 0) {
    return message.messageId;
  }
  const text = (message.text ?? '').slice(0, FALLBACK_SLICE);
  return `${message.timestamp}-${message.from}-${text}`;
}
