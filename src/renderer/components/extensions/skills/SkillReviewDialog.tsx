import { DiffViewer } from '@renderer/components/chat/viewers/DiffViewer';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { CheckCircle2, ChevronLeft, Save } from 'lucide-react';

import type { SkillReviewPreview } from '@shared/types/extensions';

interface SkillReviewDialogProps {
  open: boolean;
  preview: SkillReviewPreview | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  reviewLabel: string;
  backLabel?: string;
}

function getSkillChangeActionLabel(
  action: SkillReviewPreview['changes'][number]['action']
): string {
  if (action === 'create') return '新增';
  if (action === 'update') return '更新';
  if (action === 'delete') return '删除';
  return action;
}

export const SkillReviewDialog = ({
  open,
  preview,
  loading = false,
  error = null,
  onClose,
  onConfirm,
  confirmLabel,
  reviewLabel,
  backLabel = '返回编辑器',
}: SkillReviewDialogProps): React.JSX.Element => {
  const hasChanges = Boolean(preview && preview.changes.length > 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[min(96vw,80rem)] gap-0 overflow-hidden p-0">
        <div className="flex max-h-[85vh] min-h-0 min-w-0 flex-col">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>检查技能变更</DialogTitle>
            <DialogDescription>
              {reviewLabel} 会先预览文件系统变更。确认前不会写入任何内容。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
            {!preview && <p className="text-sm text-text-muted">暂无预览。</p>}

            {preview && (
              <div className="space-y-4">
                <div className="bg-surface-raised/10 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{preview.changes.length} 个文件变更</Badge>
                    {preview.summary.created > 0 && (
                      <Badge variant="secondary">{preview.summary.created} 个新增</Badge>
                    )}
                    {preview.summary.updated > 0 && (
                      <Badge variant="outline">{preview.summary.updated} 个更新</Badge>
                    )}
                    {preview.summary.deleted > 0 && (
                      <Badge variant="destructive">{preview.summary.deleted} 个移除</Badge>
                    )}
                    {preview.summary.binary > 0 && (
                      <Badge variant="destructive">{preview.summary.binary} 个二进制文件</Badge>
                    )}
                  </div>
                  <div className="mt-3 break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text-muted">
                    {preview.targetSkillDir}
                  </div>
                  <p className="mt-3 text-sm text-text-muted">
                    请检查下方 diff，然后点击
                    <span className="font-medium text-text"> {confirmLabel} </span>
                    应用这些变更。
                  </p>
                </div>

                {preview.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                    {preview.warnings.map((warning, index) => (
                      <p key={`${warning}-${index}`}>{warning}</p>
                    ))}
                  </div>
                )}

                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
                    {error}
                  </div>
                )}

                {!hasChanges && (
                  <div className="bg-surface-raised/10 rounded-md border border-border p-4 text-sm text-text-muted">
                    暂未检测到文件变更。
                  </div>
                )}

                <div className="space-y-4">
                  {preview.changes.map((change) => (
                    <div
                      key={change.absolutePath}
                      className="min-w-0 overflow-hidden rounded-lg border border-border p-3"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Badge variant={change.action === 'create' ? 'secondary' : 'outline'}>
                          {getSkillChangeActionLabel(change.action)}
                        </Badge>
                        <span className="text-sm text-text">{change.relativePath}</span>
                        {change.isBinary && <Badge variant="destructive">二进制</Badge>}
                      </div>

                      {change.isBinary ? (
                        <div className="bg-surface-raised/20 rounded-md border border-border p-3 text-sm text-text-muted">
                          二进制文件不显示预览。该文件会按原样复制。
                        </div>
                      ) : (
                        <div className="min-w-0 overflow-hidden">
                          <DiffViewer
                            fileName={change.relativePath}
                            oldString={change.oldContent ?? ''}
                            newString={change.newContent ?? ''}
                            maxHeight="max-h-80"
                            syntaxHighlight
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-surface px-6 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
            <Button variant="outline" onClick={onClose}>
              <ChevronLeft className="mr-1.5 size-3.5" />
              {backLabel}
            </Button>
            <Button onClick={onConfirm} disabled={loading || !preview || !hasChanges}>
              {loading ? (
                <Save className="mr-1.5 size-3.5" />
              ) : (
                <CheckCircle2 className="mr-1.5 size-3.5" />
              )}
              {loading ? '保存中...' : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
