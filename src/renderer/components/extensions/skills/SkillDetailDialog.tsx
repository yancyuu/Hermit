import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { CodeBlockViewer } from '@renderer/components/chat/viewers/CodeBlockViewer';
import { MarkdownViewer } from '@renderer/components/chat/viewers/MarkdownViewer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@renderer/components/ui/alert-dialog';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { useStore } from '@renderer/store';
import { formatSkillRootKind, getSkillAudienceLabel } from '@shared/utils/skillRoots';
import { AlertTriangle, ExternalLink, FolderOpen, Info, Pencil, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { resolveSkillProjectPath } from './skillProjectUtils';

import type { SkillValidationIssue } from '@shared/types/extensions';

interface SkillDetailDialogProps {
  skillId: string | null;
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  onEdit: () => void;
  onDeleted: () => void;
}

export const SkillDetailDialog = ({
  skillId,
  open,
  onClose,
  projectPath,
  onEdit,
  onDeleted,
}: SkillDetailDialogProps): React.JSX.Element => {
  const fetchSkillDetail = useStore((s) => s.fetchSkillDetail);
  const deleteSkill = useStore((s) => s.deleteSkill);
  const detail = useStore(useShallow((s) => (skillId ? s.skillsDetailsById[skillId] : undefined)));
  const loading = useStore((s) =>
    skillId ? (s.skillsDetailLoadingById[skillId] ?? false) : false
  );
  const detailError = useStore((s) =>
    skillId ? (s.skillsDetailErrorById[skillId] ?? null) : null
  );
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open || !skillId) return;
    void fetchSkillDetail(
      skillId,
      detail?.item.scope
        ? resolveSkillProjectPath(detail.item.scope, projectPath, detail.item.projectRoot)
        : (projectPath ?? undefined)
    ).catch(() => undefined);
  }, [detail?.item.projectRoot, detail?.item.scope, fetchSkillDetail, open, projectPath, skillId]);

  useEffect(() => {
    if (!open) {
      setDeleteError(null);
      setDeleteLoading(false);
      setDeleteConfirmOpen(false);
    }
  }, [open]);

  const item = detail?.item;
  const effectiveProjectPath = item
    ? resolveSkillProjectPath(item.scope, projectPath, item.projectRoot)
    : (projectPath ?? undefined);
  const issuesTone = item?.issues.length ? getIssuesTone(item.issues) : null;

  function formatScopeLabel(scope: 'user' | 'project'): string {
    return scope === 'project' ? '仅当前项目' : '你的个人技能';
  }

  function formatInvocationLabel(invocationMode: 'auto' | 'manual-only'): string {
    return invocationMode === 'manual-only' ? '仅在你明确要求时运行。' : '匹配任务时自动运行。';
  }

  function getIssuesTone(issues: SkillValidationIssue[]): {
    className: string;
    title: string;
    Icon: typeof AlertTriangle;
  } {
    const informationalOnly = issues.every((issue) => issue.severity === 'info');
    if (informationalOnly) {
      return {
        className: 'border-blue-500/30 bg-blue-500/5',
        title: '此技能包含随附脚本',
        Icon: Info,
      };
    }

    return {
      className: 'border-amber-500/30 bg-amber-500/5',
      title: '使用前请仔细检查此技能',
      Icon: AlertTriangle,
    };
  }

  async function handleDelete(): Promise<void> {
    if (!item) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteSkill({
        skillId: item.id,
        projectPath: effectiveProjectPath,
      });
      setDeleteConfirmOpen(false);
      onDeleted();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除技能失败');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{item?.name ?? '技能详情'}</DialogTitle>
          <DialogDescription>
            {item?.description ?? '查看已发现的技能元数据和原始说明。'}
          </DialogDescription>
        </DialogHeader>

        {(loading || (open && skillId && detail === undefined)) && (
          <p className="text-sm text-text-muted">正在加载技能详情...</p>
        )}

        {!loading && detailError && (
          <div className="space-y-3 rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
            <p>{detailError}</p>
            {skillId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void fetchSkillDetail(skillId, effectiveProjectPath).catch(() => undefined);
                }}
              >
                重试
              </Button>
            )}
          </div>
        )}

        {!loading && !detailError && detail === null && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
            无法加载此技能。
          </div>
        )}

        {!loading && detail && item && (
          <div className="space-y-4">
            {deleteError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
                {deleteError}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{formatScopeLabel(item.scope)}</Badge>
              <Badge variant="outline">存储于 {formatSkillRootKind(item.rootKind)}</Badge>
              <Badge variant="outline">{getSkillAudienceLabel(item.rootKind)}</Badge>
              <Badge variant="secondary">
                {item.invocationMode === 'manual-only' ? '手动使用' : '自动使用'}
              </Badge>
              {item.flags.hasScripts && <Badge variant="destructive">包含脚本</Badge>}
              {item.flags.hasReferences && <Badge variant="secondary">参考资料</Badge>}
              {item.flags.hasAssets && <Badge variant="secondary">资源文件</Badge>}
            </div>

            {item.issues.length > 0 && (
              <div className={`space-y-2 rounded-md border p-4 ${issuesTone?.className ?? ''}`}>
                <p
                  className={`text-sm font-medium ${
                    issuesTone?.Icon === Info
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {issuesTone?.title}
                </p>
                {item.issues.map((issue, index) => (
                  <div
                    key={`${issue.code}-${index}`}
                    className={`flex gap-2 text-sm ${
                      issue.severity === 'info'
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {issue.severity === 'info' ? (
                      <Info className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-3">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  谁可以使用
                </p>
                <p className="text-sm text-text">{formatScopeLabel(item.scope)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  如何使用
                </p>
                <p className="text-sm text-text">{formatInvocationLabel(item.invocationMode)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  随附内容
                </p>
                <p className="text-sm text-text">
                  {[
                    item.flags.hasReferences ? '参考资料' : null,
                    item.flags.hasScripts ? '脚本' : null,
                    item.flags.hasAssets ? '资源文件' : null,
                  ]
                    .filter(Boolean)
                    .join('、') || '仅技能说明'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={onEdit}>
                <Pencil className="mr-1.5 size-3.5" />
                编辑技能
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleteLoading}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                {deleteLoading ? '正在删除...' : '删除'}
              </Button>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 rounded-lg border border-border p-4">
                <MarkdownViewer
                  content={detail.body || detail.rawContent}
                  baseDir={item.skillDir}
                  bare
                  copyable
                />
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border p-3 text-sm text-text-secondary">
                  <div className="space-y-2">
                    <p className="font-medium text-text">存储位置</p>
                    <p className="break-all text-xs text-text-muted">{item.skillDir}</p>
                  </div>

                  {detail.scriptFiles.length > 0 && (
                    <div className="mt-4 space-y-1">
                      <p className="font-medium text-text">脚本</p>
                      {detail.scriptFiles.map((file) => (
                        <p key={file} className="text-xs text-text-muted">
                          {file}
                        </p>
                      ))}
                    </div>
                  )}

                  {detail.referencesFiles.length > 0 && (
                    <div className="mt-4 space-y-1">
                      <p className="font-medium text-text">参考资料</p>
                      {detail.referencesFiles.map((file) => (
                        <p key={file} className="text-xs text-text-muted">
                          {file}
                        </p>
                      ))}
                    </div>
                  )}

                  {detail.assetFiles.length > 0 && (
                    <div className="mt-4 space-y-1">
                      <p className="font-medium text-text">资源文件</p>
                      {detail.assetFiles.map((file) => (
                        <p key={file} className="text-xs text-text-muted">
                          {file}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <details className="rounded-lg border border-border p-3 text-sm text-text-secondary">
                  <summary className="cursor-pointer font-medium text-text">高级文件详情</summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void api.showInFolder(item.skillFile)}
                      >
                        <FolderOpen className="mr-1.5 size-3.5" />
                        打开文件夹
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void api.openPath(item.skillFile, effectiveProjectPath)}
                      >
                        <ExternalLink className="mr-1.5 size-3.5" />
                        打开 SKILL.md
                      </Button>
                    </div>
                    <CodeBlockViewer
                      fileName={item.skillFile}
                      content={detail.rawContent}
                      maxHeight="max-h-72"
                    />
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除技能？</AlertDialogTitle>
            <AlertDialogDescription>
              {item
                ? `删除“${item.name}”并移入废纸篓？需要时可以稍后从废纸篓恢复。`
                : '删除此技能并移入废纸篓？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={deleteLoading}>
              {deleteLoading ? '正在删除...' : '删除技能'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
