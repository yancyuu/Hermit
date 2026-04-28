/**
 * ContextSwitchOverlay - Full-screen loading overlay during context switches.
 *
 * Displayed when isContextSwitching is true, preventing stale data flash
 * during workspace transitions.
 */

import React from 'react';

import { useStore } from '@renderer/store';

export const ContextSwitchOverlay: React.FC = () => {
  const isContextSwitching = useStore((state) => state.isContextSwitching);
  const targetContextId = useStore((state) => state.targetContextId);

  if (!isContextSwitching) {
    return null;
  }

  // Format context label for display
  const contextLabel =
    targetContextId === 'local' ? '本地' : (targetContextId?.replace(/^ssh-/, '') ?? '未知');

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-4">
        {/* Spinner */}
        <div className="size-8 animate-spin rounded-full border-4 border-text border-t-transparent" />

        {/* Text */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-text">正在切换到 {contextLabel}...</p>
          <p className="text-sm text-text-secondary">正在加载工作区</p>
        </div>
      </div>
    </div>
  );
};
