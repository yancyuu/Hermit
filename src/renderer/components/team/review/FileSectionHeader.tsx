import React from 'react';

import { FileIcon } from '@renderer/components/team/editor/FileIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { shortcutLabel } from '@renderer/utils/platformKeys';
import { ChevronDown, ChevronRight, FilePlus, GitBranch, Loader2, Save, Undo2 } from 'lucide-react';

import type { FileChangeWithContent, HunkDecision } from '@shared/types';
import type { FileChangeSummary } from '@shared/types/review';

const CONTENT_SOURCE_LABELS: Record<string, string> = {
  'ledger-exact': 'Task Ledger',
  'ledger-snapshot': 'Ledger Snapshot',
  'file-history': 'File History',
  'snippet-reconstruction': 'Reconstructed',
  'disk-current': 'Current Disk',
  'git-fallback': 'Git Fallback',
  unavailable: 'Content unavailable',
};

interface FileSectionHeaderProps {
  file: FileChangeSummary;
  fileContent: FileChangeWithContent | null;
  fileDecision: HunkDecision | undefined;
  externalChange?: { type: 'change' | 'add' | 'unlink' };
  pathChangeLabel?:
    | { kind: 'deleted' }
    | { kind: 'copied' | 'moved' | 'renamed'; direction: 'from' | 'to'; otherPath: string };
  hasEdits: boolean;
  applying: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (filePath: string) => void;
  onDiscard: (filePath: string) => void;
  onSave: (filePath: string) => void;
  onReloadFromDisk?: (filePath: string) => void;
  onKeepDraft?: (filePath: string) => void;
  onRestoreMissingFile?: (filePath: string, content: string) => void;
  onAcceptFile?: (filePath: string) => void;
  onRejectFile?: (filePath: string) => void;
}

export const FileSectionHeader = ({
  file,
  fileContent,
  fileDecision,
  externalChange,
  pathChangeLabel,
  hasEdits,
  applying,
  isCollapsed,
  onToggleCollapse,
  onDiscard,
  onSave,
  onReloadFromDisk,
  onKeepDraft,
  onRestoreMissingFile,
  onAcceptFile,
  onRejectFile,
}: FileSectionHeaderProps): React.ReactElement => {
  const isMissingOnDisk = fileContent ? fileContent.modifiedFullContent == null : false;
  const isContentUnavailable = fileContent?.contentSource === 'unavailable';
  const isPreviewOnly = isMissingOnDisk || isContentUnavailable;
  const requiresManualLedgerReview = file.snippets.some(
    (snippet) =>
      !!snippet.ledger &&
      (!!snippet.ledger.beforeState?.unavailableReason ||
        !!snippet.ledger.afterState?.unavailableReason) &&
      (snippet.ledger.originalFullContent == null || snippet.ledger.modifiedFullContent == null)
  );
  const rejectDisabled = isPreviewOnly || requiresManualLedgerReview;
  const restoreContent =
    fileContent?.modifiedFullContent ??
    (() => {
      const writeSnippets = file.snippets.filter(
        (s) => !s.isError && (s.type === 'write-new' || s.type === 'write-update')
      );
      if (writeSnippets.length === 0) return null;
      return writeSnippets[writeSnippets.length - 1].newString;
    })();
  const canRestore =
    !!onRestoreMissingFile &&
    isMissingOnDisk &&
    !isContentUnavailable &&
    !hasEdits &&
    restoreContent != null;
  const externalChangeLabel =
    externalChange?.type === 'unlink'
      ? 'Deleted on disk'
      : externalChange?.type === 'add'
        ? 'Recreated on disk'
        : externalChange?.type === 'change'
          ? 'Changed on disk'
          : null;

  const handleHeaderClick = (e: React.MouseEvent): void => {
    // Don't collapse when clicking action buttons
    if ((e.target as HTMLElement).closest('[data-no-collapse]')) return;
    onToggleCollapse(file.filePath);
  };

  const handleHeaderKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleCollapse(file.filePath);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleHeaderClick}
      onKeyDown={handleHeaderKeyDown}
      className="hover:bg-surface-raised/50 sticky top-0 z-10 flex cursor-pointer select-none items-center gap-2 border-b border-border bg-surface-sidebar px-4 py-2"
    >
      <span className="flex shrink-0 items-center text-text-muted">
        {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </span>
      <FileIcon fileName={file.relativePath} className="size-3.5" />
      <span className="text-xs font-medium text-text">{file.relativePath}</span>

      {file.isNewFile && (
        <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
          NEW
        </span>
      )}

      {pathChangeLabel?.kind === 'deleted' && (
        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">
          DELETED
        </span>
      )}

      {pathChangeLabel && pathChangeLabel.kind !== 'deleted' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">
              {pathChangeLabel.kind.toUpperCase()}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            {pathChangeLabel.direction === 'from' ? 'From' : 'To'} {pathChangeLabel.otherPath}
          </TooltipContent>
        </Tooltip>
      )}

      {fileContent?.contentSource && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={[
                'rounded px-1.5 py-0.5 text-[10px]',
                isPreviewOnly ? 'bg-red-500/20 text-red-300' : 'bg-surface-raised text-text-muted',
              ].join(' ')}
            >
              {isContentUnavailable
                ? '内容不可用'
                : isMissingOnDisk
                  ? '磁盘中缺失'
                  : (CONTENT_SOURCE_LABELS[fileContent.contentSource] ?? fileContent.contentSource)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            {isContentUnavailable ? (
              <div className="space-y-1">
                <div className="font-medium text-text">文本内容不可用</div>
                <div className="text-text-muted">
                  变更台账记录了该变更的元数据，但完整文本内容不可用。这通常表示内容是二进制、大文件或仅哈希记录。
                </div>
                <div className="text-text-muted">
                  为避免不安全的磁盘写入，此文件已禁用自动接受/拒绝。
                </div>
              </div>
            ) : isMissingOnDisk ? (
              <div className="space-y-1">
                <div className="font-medium text-text">文件在磁盘中缺失</div>
                <div className="text-text-muted">
                  仍可从 Agent 日志中显示预览，但你的文件系统已不同步。
                </div>
                {restoreContent != null ? (
                  <div className="text-text-muted">
                    使用 <span className="font-medium text-text">恢复</span> 将预览内容写回磁盘。
                  </div>
                ) : (
                  <div className="text-text-muted">完整文件内容不可用，无法自动恢复。</div>
                )}
              </div>
            ) : (
              <span>
                {CONTENT_SOURCE_LABELS[fileContent.contentSource] ?? fileContent.contentSource}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      )}

      {file.ledgerSummary?.worktreePath && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">
              <GitBranch className="size-3" />
              WORKTREE
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-sm">
            <div className="space-y-1">
              <div className="font-medium text-text">
                {file.ledgerSummary.worktreeBranch ?? '隔离 worktree'}
              </div>
              <div className="break-all text-text-muted">{file.ledgerSummary.worktreePath}</div>
              {file.ledgerSummary.dirtyLeaderWarning && (
                <div className="text-amber-300">{file.ledgerSummary.dirtyLeaderWarning}</div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {fileDecision && (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            fileDecision === 'accepted'
              ? 'bg-green-500/20 text-green-400'
              : fileDecision === 'rejected'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-zinc-500/20 text-zinc-400'
          }`}
        >
          {fileDecision}
        </span>
      )}

      {externalChangeLabel && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
          {externalChangeLabel}
        </span>
      )}

      {requiresManualLedgerReview && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
          手动评审
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5" data-no-collapse>
        {externalChange && onReloadFromDisk && onKeepDraft && (
          <div className="mr-1 flex items-center gap-1.5">
            <button
              onClick={() => onReloadFromDisk(file.filePath)}
              disabled={applying}
              className="rounded bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/25 disabled:opacity-50"
            >
              从磁盘重新加载
            </button>
            <button
              onClick={() => onKeepDraft(file.filePath)}
              disabled={applying}
              className="rounded bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
            >
              保留我的草稿
            </button>
          </div>
        )}

        {(onAcceptFile || onRejectFile) && (
          <div className="mr-1 flex items-center gap-1.5">
            {onAcceptFile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <button
                      onClick={() => onAcceptFile(file.filePath)}
                      disabled={applying || isPreviewOnly}
                      className={[
                        'rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                        fileDecision === 'accepted'
                          ? 'bg-green-500/25 text-green-300'
                          : 'bg-green-500/15 text-green-400 hover:bg-green-500/25',
                      ].join(' ')}
                    >
                      接受
                    </button>
                  </span>
                </TooltipTrigger>
                {isPreviewOnly && (
                  <TooltipContent side="bottom">
                    {isContentUnavailable
                      ? '完整文本内容不可用，已禁用接受/拒绝。'
                      : '文件在磁盘中缺失，已禁用接受/拒绝。'}
                  </TooltipContent>
                )}
              </Tooltip>
            )}
            {onRejectFile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <button
                      onClick={() => onRejectFile(file.filePath)}
                      disabled={applying || rejectDisabled}
                      className={[
                        'rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                        fileDecision === 'rejected'
                          ? 'bg-red-500/25 text-red-300'
                          : 'bg-red-500/15 text-red-400 hover:bg-red-500/25',
                      ].join(' ')}
                    >
                      拒绝
                    </button>
                  </span>
                </TooltipTrigger>
                {rejectDisabled && (
                  <TooltipContent side="bottom">
                    {requiresManualLedgerReview
                      ? '该台账变更包含二进制、大文件或不可用内容，已禁用拒绝。'
                      : isContentUnavailable
                        ? '完整文本内容不可用，已禁用拒绝。'
                        : '文件在磁盘中缺失，已禁用接受/拒绝。'}
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
        )}
        {canRestore && restoreContent != null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onRestoreMissingFile?.(file.filePath, restoreContent)}
                disabled={applying}
                className="flex items-center gap-1 rounded bg-blue-500/15 px-2 py-1 text-xs text-blue-300 transition-colors hover:bg-blue-500/25 disabled:opacity-50"
              >
                <FilePlus className="size-3" />
                恢复
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">根据预览在磁盘中创建/恢复此文件</TooltipContent>
          </Tooltip>
        )}
        {hasEdits && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDiscard(file.filePath)}
                  className="flex items-center gap-1 rounded bg-orange-500/15 px-2 py-1 text-xs text-orange-400 transition-colors hover:bg-orange-500/25"
                >
                  <Undo2 className="size-3" />
                  丢弃
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">丢弃此文件的全部编辑</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSave(file.filePath)}
                  disabled={applying}
                  className="flex items-center gap-1 rounded bg-green-500/15 px-2 py-1 text-xs text-green-400 transition-colors hover:bg-green-500/25 disabled:opacity-50"
                >
                  {applying ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Save className="size-3" />
                  )}
                  保存文件
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span>将文件保存到磁盘</span>
                <kbd className="ml-2 rounded border border-border bg-surface-raised px-1 py-0.5 font-mono text-[10px] text-text-muted">
                  {shortcutLabel('⌘ S', 'Ctrl+S')}
                </kbd>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
};
