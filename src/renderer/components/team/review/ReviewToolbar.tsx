import React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { cn } from '@renderer/lib/utils';
import { Check, Eye, EyeOff, GitMerge, Loader2, Pencil, Undo2, X } from 'lucide-react';

import type { ChangeStats } from '@shared/types';

interface ReviewToolbarProps {
  stats: { pending: number; accepted: number; rejected: number };
  changeStats: ChangeStats;
  collapseUnchanged: boolean;
  applying: boolean;
  autoViewed: boolean;
  instantApply?: boolean;
  onAutoViewedChange: (auto: boolean) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onApply: () => void;
  onCollapseUnchangedChange: (collapse: boolean) => void;
  editedCount?: number;
  canUndo?: boolean;
  onUndo?: () => void;
}

export const ReviewToolbar = ({
  stats,
  changeStats,
  collapseUnchanged: _collapseUnchanged,
  applying,
  autoViewed,
  onAutoViewedChange,
  onAcceptAll,
  onRejectAll,
  onApply,
  onCollapseUnchangedChange: _onCollapseUnchangedChange,
  instantApply = false,
  editedCount = 0,
  canUndo = false,
  onUndo,
}: ReviewToolbarProps): React.ReactElement => {
  const hasRejected = stats.rejected > 0;
  const canApply = hasRejected && !applying;
  const totalChanges = stats.pending + stats.accepted + stats.rejected;
  const reviewedCount = stats.accepted + stats.rejected;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface-sidebar px-4 py-2">
      {/* Decision stats */}
      <div className="flex items-center gap-2 text-xs">
        {stats.pending > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/20 px-2 py-0.5 text-zinc-400">
            {stats.pending} pending
          </span>
        )}
        {stats.accepted > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-green-400">
            <Check className="size-3" />
            {stats.accepted} accepted
          </span>
        )}
        {stats.rejected > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-red-400">
            <X className="size-3" />
            {stats.rejected} rejected
          </span>
        )}
      </div>

      {/* Change stats */}
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <span className="text-green-400">+{changeStats.linesAdded}</span>
        <span className="text-red-400">-{changeStats.linesRemoved}</span>
        <span className="ml-1">across {changeStats.filesChanged} files</span>
      </div>

      {/* Review progress */}
      {totalChanges > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-700/50">
            <div
              className="h-full rounded-full bg-blue-500/70 transition-all duration-300"
              style={{ width: `${(reviewedCount / totalChanges) * 100}%` }}
            />
          </div>
          <span className="text-text-muted">
            {reviewedCount}/{totalChanges}
          </span>
        </div>
      )}

      <div className="flex-1" />

      {/* <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onCollapseUnchangedChange(!collapseUnchanged)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
              collapseUnchanged ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text'
            )}
          >
            {collapseUnchanged ? (
              <FoldVertical className="size-3.5" />
            ) : (
              <UnfoldVertical className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {collapseUnchanged ? 'Show all lines' : 'Collapse unchanged regions'}
        </TooltipContent>
      </Tooltip> */}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onAutoViewedChange(!autoViewed)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
              autoViewed ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text'
            )}
          >
            {autoViewed ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            <span className="text-[10px]">自动</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {autoViewed
            ? '滚动到末尾时自动标记文件已查看（开）'
            : '滚动到末尾时自动标记文件已查看（关）'}
        </TooltipContent>
      </Tooltip>

      <div className="h-4 w-px bg-border" />

      {editedCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
          <Pencil className="size-3" /> 已编辑 {editedCount} 个
        </span>
      )}

      {editedCount > 0 && <div className="h-4 w-px bg-border" />}

      {canUndo && onUndo && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onUndo}
              className="flex items-center gap-1 rounded bg-zinc-500/15 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-500/25"
            >
              <Undo2 className="size-3" />
              撤销
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">撤销上一次评审操作（Ctrl+Z）</TooltipContent>
        </Tooltip>
      )}

      {/* Actions hidden when all hunks are already decided */}
      {stats.pending > 0 && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onAcceptAll}
                className="flex items-center gap-1 rounded bg-green-500/15 px-2.5 py-1 text-xs text-green-400 transition-colors hover:bg-green-500/25"
              >
                <Check className="size-3" />
                全部接受
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">接受所有文件中的全部变更</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRejectAll}
                className="flex items-center gap-1 rounded bg-red-500/15 px-2.5 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/25"
              >
                <X className="size-3" />
                全部拒绝
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">拒绝所有文件中的全部变更</TooltipContent>
          </Tooltip>
        </>
      )}

      {!instantApply && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onApply}
              disabled={!canApply}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1 text-xs font-medium transition-colors',
                canApply
                  ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                  : 'cursor-not-allowed bg-zinc-500/10 text-zinc-600'
              )}
            >
              {applying ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <GitMerge className="size-3" />
              )}
              {applying ? 'Applying...' : 'Apply Rejections'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Apply rejected hunks to disk; accepted changes are kept as-is
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
