import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { useStore } from '@renderer/store';
import { SKILL_ROOT_DEFINITIONS } from '@shared/utils/skillRoots';
import { FileSearch, FolderOpen, X } from 'lucide-react';

import { getSuggestedSkillFolderNameFromPath } from './skillFolderNameUtils';
import { resolveSkillProjectPath } from './skillProjectUtils';
import { SkillReviewDialog } from './SkillReviewDialog';
import { validateSkillFolderName, validateSkillImportSourceDir } from './skillValidationUtils';

import type { SkillReviewPreview, SkillRootKind } from '@shared/types/extensions';

function getFriendlyImportError(message: string): string {
  if (message.includes('valid skill file')) {
    return '这个文件夹还不像一个技能目录。需要包含 SKILL.md、Skill.md 或 skill.md 文件。';
  }
  if (message.includes('symbolic links')) {
    return '此文件夹包含符号链接。请导入真实文件，而不是链接。';
  }
  if (message.includes('too many files')) {
    return '这个技能文件夹文件过多，无法一次导入。请移除多余文件后重试。';
  }
  if (message.includes('too large')) {
    return '这个技能文件夹过大，无法安全导入。请精简大型素材后重试。';
  }
  if (message.includes('Invalid folder name')) {
    return '请选择更简单的目标文件夹名称，可使用字母、数字、点、短横线或下划线。';
  }
  if (message.includes('must be a directory')) {
    return '请选择要导入的文件夹，而不是单个文件。';
  }
  return message;
}

interface SkillImportDialogProps {
  open: boolean;
  projectPath: string | null;
  projectLabel: string | null;
  onClose: () => void;
  onImported: (skillId: string | null) => void;
}

export const SkillImportDialog = ({
  open,
  projectPath,
  projectLabel,
  onClose,
  onImported,
}: SkillImportDialogProps): React.JSX.Element => {
  const previewSkillImport = useStore((s) => s.previewSkillImport);
  const applySkillImport = useStore((s) => s.applySkillImport);

  const [sourceDir, setSourceDir] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderNameEdited, setFolderNameEdited] = useState(false);
  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [rootKind, setRootKind] = useState<SkillRootKind>('hermit');
  const [preview, setPreview] = useState<SkillReviewPreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSourceDir('');
    setFolderName('');
    setFolderNameEdited(false);
    setScope(projectPath ? 'project' : 'user');
    setRootKind(projectPath ? 'claude' : 'hermit');
    setPreview(null);
    setReviewOpen(false);
    setReviewLoading(false);
    setImportLoading(false);
    setMutationError(null);
  }, [open, projectPath]);

  useEffect(() => {
    if (open) {
      return;
    }

    setPreview(null);
    setReviewOpen(false);
    setReviewLoading(false);
    setImportLoading(false);
    setMutationError(null);
  }, [open]);

  useEffect(() => {
    if (!open || folderNameEdited) {
      return;
    }
    setFolderName(sourceDir.trim() ? getSuggestedSkillFolderNameFromPath(sourceDir) : '');
  }, [folderNameEdited, open, sourceDir]);

  useEffect(() => {
    if (open && scope === 'project' && !projectPath) {
      setScope('user');
    }
  }, [open, projectPath, scope]);

  useEffect(() => {
    if (open && scope === 'user' && rootKind !== 'hermit') {
      setRootKind('hermit');
    } else if (open && scope === 'project' && rootKind === 'hermit') {
      setRootKind('claude');
    }
  }, [open, rootKind, scope]);

  const visibleRootDefinitions =
    scope === 'user'
      ? SKILL_ROOT_DEFINITIONS.filter((definition) => definition.rootKind === 'hermit')
      : SKILL_ROOT_DEFINITIONS.filter((definition) => definition.rootKind !== 'hermit');

  async function handleChooseFolder(): Promise<void> {
    const selected = await api.config.selectFolders();
    const first = selected[0];
    if (!first) return;
    setSourceDir(first);
  }

  async function handleReview(): Promise<void> {
    const normalizedSourceDir = sourceDir.trim();
    const normalizedFolderName = folderName.trim();
    const sourceDirError = validateSkillImportSourceDir(sourceDir);
    if (sourceDirError) {
      setMutationError(sourceDirError);
      return;
    }

    const folderNameError =
      normalizedFolderName.length > 0 ? validateSkillFolderName(normalizedFolderName) : null;
    if (folderNameError) {
      setMutationError(folderNameError);
      return;
    }

    setReviewLoading(true);
    setMutationError(null);
    try {
      const nextPreview = await previewSkillImport({
        sourceDir: normalizedSourceDir,
        folderName: normalizedFolderName || undefined,
        scope,
        rootKind,
        projectPath: resolveSkillProjectPath(scope, projectPath),
      });
      setPreview(nextPreview);
      setReviewOpen(true);
    } catch (error) {
      setMutationError(
        getFriendlyImportError(error instanceof Error ? error.message : '检查导入变更失败')
      );
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleConfirmImport(): Promise<void> {
    const normalizedSourceDir = sourceDir.trim();
    const normalizedFolderName = folderName.trim();

    setImportLoading(true);
    setMutationError(null);
    try {
      const detail = await applySkillImport({
        sourceDir: normalizedSourceDir,
        folderName: normalizedFolderName || undefined,
        scope,
        rootKind,
        projectPath: resolveSkillProjectPath(scope, projectPath),
        reviewPlanId: preview?.planId,
      });
      setReviewOpen(false);
      onImported(detail?.item.id ?? null);
      onClose();
    } catch (error) {
      setMutationError(
        getFriendlyImportError(error instanceof Error ? error.message : '导入技能失败')
      );
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="gap-0 overflow-hidden p-0">
          <div className="flex max-h-[85vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border px-6 py-5">
              <DialogTitle>导入技能</DialogTitle>
              <DialogDescription>
                选择已有技能文件夹，检查将要复制的内容，然后导入到支持的技能位置。
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-5">
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-text">1. 选择技能文件夹</h3>
                  <p className="text-sm text-text-muted">
                    请选择已包含 `SKILL.md`、`Skill.md` 或 `skill.md` 文件的文件夹。
                  </p>
                </section>
                <div className="space-y-2">
                  <Label htmlFor="skill-import-source">源文件夹</Label>
                  <div className="flex gap-2">
                    <Input
                      id="skill-import-source"
                      value={sourceDir}
                      onChange={(event) => setSourceDir(event.target.value)}
                    />
                    <Button variant="outline" onClick={() => void handleChooseFolder()}>
                      <FolderOpen className="mr-1.5 size-3.5" />
                      浏览
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="skill-import-folder">目标文件夹名称</Label>
                  <Input
                    id="skill-import-folder"
                    value={folderName}
                    onChange={(event) => {
                      setFolderNameEdited(true);
                      setFolderName(event.target.value);
                    }}
                    placeholder="默认使用源文件夹名称"
                  />
                </div>

                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-text">2. 选择存放位置</h3>
                  <p className="text-sm text-text-muted">
                    个人技能会在所有地方生效；项目技能只会出现在一个代码库中。
                  </p>
                </section>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="skill-import-scope">谁可以使用</Label>
                    <Select
                      value={scope}
                      onValueChange={(value) => setScope(value as 'user' | 'project')}
                    >
                      <SelectTrigger id="skill-import-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">个人</SelectItem>
                        <SelectItem value="project" disabled={!projectPath}>
                          {projectPath ? `项目：${projectLabel ?? projectPath}` : '项目不可用'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="skill-import-root">存储位置</Label>
                    <Select
                      value={rootKind}
                      onValueChange={(value) => setRootKind(value as SkillRootKind)}
                    >
                      <SelectTrigger id="skill-import-root">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleRootDefinitions.map((definition) => (
                          <SelectItem key={definition.rootKind} value={definition.rootKind}>
                            {definition.rootKind === 'hermit'
                              ? '~/.hermit/skills'
                              : `${definition.directoryName}/skills`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {mutationError && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
                    {mutationError}
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-6 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
              <Button variant="outline" onClick={onClose}>
                <X className="mr-1.5 size-3.5" />
                取消
              </Button>
              <p className="min-w-64 flex-1 text-sm text-text-muted">
                请先检查复制的文件，然后在下一步确认导入。
              </p>
              <Button
                onClick={() => void handleReview()}
                disabled={!sourceDir.trim() || reviewLoading || importLoading}
              >
                <FileSearch className="mr-1.5 size-3.5" />
                {reviewLoading ? '准备中...' : '检查并导入'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SkillReviewDialog
        open={reviewOpen}
        preview={preview}
        loading={importLoading}
        error={mutationError}
        onClose={() => setReviewOpen(false)}
        onConfirm={() => void handleConfirmImport()}
        confirmLabel="导入技能"
        reviewLabel="正在导入此技能"
        backLabel="返回导入"
      />
    </>
  );
};
