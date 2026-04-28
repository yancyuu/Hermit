import type { JSX } from 'react';
/**
 * Empty state for ChatHistory when no conversation exists.
 */
export const ChatHistoryEmptyState = (): JSX.Element => {
  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden bg-surface">
      <div className="space-y-2 text-center text-text-muted">
        <div className="mb-4 text-6xl">💬</div>
        <div className="text-xl font-medium text-text-secondary">No conversation history</div>
        <div className="text-sm">This session does not contain any messages yet.</div>
      </div>
    </div>
  );
};
