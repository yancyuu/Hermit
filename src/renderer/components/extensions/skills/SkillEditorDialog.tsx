import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MarkdownPreviewPane } from '@renderer/components/team/editor/MarkdownPreviewPane';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from '@renderer/components/ui/textarea';
import { useMarkdownScrollSync } from '@renderer/hooks/useMarkdownScrollSync';
import { useStore } from '@renderer/store';
import { SKILL_ROOT_DEFINITIONS } from '@shared/utils/skillRoots';
import { FileSearch, RotateCcw, X } from 'lucide-react';

import { SkillCodeEditor } from './SkillCodeEditor';
import {
  buildSkillDraftFiles,
  buildSkillTemplate,
  readSkillTemplateContent,
  updateSkillTemplateFrontmatter,
} from './skillDraftUtils';
import { toSuggestedSkillFolderName } from './skillFolderNameUtils';
import { resolveSkillProjectPath } from './skillProjectUtils';
import { SkillReviewDialog } from './SkillReviewDialog';
import { validateSkillFolderName } from './skillValidationUtils';

import type {
  SkillDetail,
  SkillInvocationMode,
  SkillReviewPreview,
  SkillRootKind,
} from '@shared/types/extensions';

type EditorMode = 'create' | 'edit';

interface SkillEditorDialogProps {
  open: boolean;
  mode: EditorMode;
  projectPath: string | null;
  projectLabel: string | null;
  detail: SkillDetail | null;
  onClose: () => void;
  onSaved: (skillId: string | null) => void;
}

function parseInitialName(detail: SkillDetail | null): string {
  return detail?.item.name ?? '';
}

function parseInitialDescription(detail: SkillDetail | null): string {
  return detail?.item.description ?? '';
}

export const SkillEditorDialog = ({
  open,
  mode,
  projectPath,
  projectLabel,
  detail,
  onClose,
  onSaved,
}: SkillEditorDialogProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLElement | null>(null);
  const rawContentRef = useRef('');
  const previewSkillUpsert = useStore((s) => s.previewSkillUpsert);
  const applySkillUpsert = useStore((s) => s.applySkillUpsert);

  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [rootKind, setRootKind] = useState<SkillRootKind>('hermit');
  const [folderName, setFolderName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [license, setLicense] = useState('');
  const [compatibility, setCompatibility] = useState('');
  const [invocationMode, setInvocationMode] = useState<SkillInvocationMode>('auto');
  const [whenToUse, setWhenToUse] = useState('');
  const [steps, setSteps] = useState('');
  const [notes, setNotes] = useState('');
  const [includeScripts, setIncludeScripts] = useState(false);
  const [includeReferences, setIncludeReferences] = useState(false);
  const [includeAssets, setIncludeAssets] = useState(false);
  const [rawContent, setRawContent] = useState('');
  const [folderNameEdited, setFolderNameEdited] = useState(false);
  const [customMarkdownDetected, setCustomMarkdownDetected] = useState(false);
  const [manualRawEdit, setManualRawEdit] = useState(false);
  const [showAdvancedEditor, setShowAdvancedEditor] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.52);
  const [isResizing, setIsResizing] = useState(false);
  const [reviewPreview, setReviewPreview] = useState<SkillReviewPreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const scrollSync = useMarkdownScrollSync(
    showAdvancedEditor,
    detail?.item.id ?? (mode === 'create' ? 'create-skill' : 'edit-skill'),
    { editorScrollRef }
  );

  const applyFormToRawContent = useCallback(
    (
      nextValues: Partial<{
        name: string;
        description: string;
        license: string;
        compatibility: string;
        invocationMode: SkillInvocationMode;
        whenToUse: string;
        steps: string;
        notes: string;
      }>
    ) => {
      const merged = {
        name,
        description,
        license,
        compatibility,
        invocationMode,
        whenToUse,
        steps,
        notes,
        ...nextValues,
      };
      const nextRawContent =
        !manualRawEdit && !customMarkdownDetected
          ? buildSkillTemplate(merged)
          : updateSkillTemplateFrontmatter(rawContentRef.current, merged);

      rawContentRef.current = nextRawContent;
      setRawContent(nextRawContent);
    },
    [
      compatibility,
      description,
      invocationMode,
      license,
      manualRawEdit,
      customMarkdownDetected,
      name,
      notes,
      steps,
      whenToUse,
    ]
  );

  useEffect(() => {
    if (!open) return;

    const item = detail?.item;
    const nextScope = item?.scope ?? (projectPath ? 'project' : 'user');
    const nextRootKind = item?.rootKind ?? (nextScope === 'project' ? 'claude' : 'hermit');
    const nextFolderName = item?.folderName ?? '';
    const nextName = parseInitialName(detail);
    const nextDescription = parseInitialDescription(detail);
    const nextLicense = item?.license ?? '';
    const nextCompatibility = item?.compatibility ?? '';
    const nextInvocationMode = item?.invocationMode ?? 'auto';
    const nextWhenToUse = '当任务符合这些条件时使用这个技能。';
    const nextSteps = '1. 描述第一步。\n2. 描述第二步。';
    const nextNotes = '- 添加注意事项、评审规则或参考资料。';
    const nextRawContent =
      detail?.rawContent ??
      buildSkillTemplate({
        name: nextName || '新技能',
        description: nextDescription || '描述这个技能能帮助完成什么。',
        license: nextLicense,
        compatibility: nextCompatibility,
        invocationMode: nextInvocationMode,
        whenToUse: nextWhenToUse,
        steps: nextSteps,
        notes: nextNotes,
      });
    const rawInput = readSkillTemplateContent(nextRawContent);
    const suggestedFolderName = toSuggestedSkillFolderName(nextName || '新技能');
    const hasCustomMarkdown = mode === 'edit' && rawInput.hasUnstructuredBody;

    setScope(nextScope);
    setRootKind(nextRootKind);
    setFolderName(nextFolderName || suggestedFolderName || nextName || '');
    setFolderNameEdited(Boolean(item?.folderName));
    setName(rawInput.name || nextName || '新技能');
    setDescription(rawInput.description || nextDescription || '描述这个技能能帮助完成什么。');
    setLicense(rawInput.license ?? nextLicense);
    setCompatibility(rawInput.compatibility ?? nextCompatibility);
    setInvocationMode(rawInput.invocationMode ?? nextInvocationMode);
    setWhenToUse(
      hasCustomMarkdown
        ? (rawInput.bodyMarkdown ?? nextRawContent)
        : (rawInput.whenToUse ?? nextWhenToUse)
    );
    setSteps(hasCustomMarkdown ? '' : (rawInput.steps ?? nextSteps));
    setNotes(hasCustomMarkdown ? '' : (rawInput.notes ?? nextNotes));
    setIncludeScripts(item?.flags.hasScripts ?? false);
    setIncludeReferences(item?.flags.hasReferences ?? false);
    setIncludeAssets(item?.flags.hasAssets ?? false);
    setCustomMarkdownDetected(hasCustomMarkdown);
    rawContentRef.current = nextRawContent;
    setRawContent(nextRawContent);
    setManualRawEdit(false);
    setShowAdvancedEditor(hasCustomMarkdown);
    setReviewPreview(null);
    setReviewOpen(false);
    setReviewLoading(false);
    setSaveLoading(false);
    setMutationError(null);
  }, [detail, mode, open, projectPath]);

  useEffect(() => {
    if (open) {
      return;
    }

    setReviewPreview(null);
    setReviewOpen(false);
    setReviewLoading(false);
    setSaveLoading(false);
    setMutationError(null);
  }, [open]);

  useEffect(() => {
    if (open && mode === 'create' && scope === 'project' && !projectPath) {
      setScope('user');
    }
  }, [mode, open, projectPath, scope]);

  useEffect(() => {
    if (!open || mode !== 'create') return;
    if (scope === 'user' && rootKind !== 'hermit') {
      setRootKind('hermit');
    } else if (scope === 'project' && rootKind === 'hermit') {
      setRootKind('claude');
    }
  }, [mode, open, rootKind, scope]);

  useEffect(() => {
    rawContentRef.current = rawContent;
  }, [rawContent]);

  const effectiveProjectPath = useMemo(
    () =>
      resolveSkillProjectPath(
        scope,
        projectPath,
        mode === 'edit' ? detail?.item.projectRoot : undefined
      ),
    [detail?.item.projectRoot, mode, projectPath, scope]
  );

  const request = useMemo(
    () => ({
      scope,
      rootKind,
      projectPath: effectiveProjectPath,
      folderName,
      existingSkillId: mode === 'edit' ? detail?.item.id : undefined,
      files: buildSkillDraftFiles({
        rawContent,
        includeScripts,
        includeReferences,
        includeAssets,
      }),
    }),
    [
      detail?.item.id,
      folderName,
      includeAssets,
      includeReferences,
      includeScripts,
      mode,
      rawContent,
      rootKind,
      scope,
      effectiveProjectPath,
    ]
  );
  const draftFilePaths = useMemo(
    () => request.files.map((file) => file.relativePath),
    [request.files]
  );
  const auxiliaryDraftFilePaths = useMemo(
    () => draftFilePaths.filter((filePath) => filePath !== 'SKILL.md'),
    [draftFilePaths]
  );

  const canUseProjectScope = Boolean(projectPath);
  const visibleRootDefinitions = useMemo(
    () =>
      scope === 'user'
        ? SKILL_ROOT_DEFINITIONS.filter((definition) => definition.rootKind === 'hermit')
        : SKILL_ROOT_DEFINITIONS.filter((definition) => definition.rootKind !== 'hermit'),
    [scope]
  );
  const instructionsLocked = manualRawEdit || customMarkdownDetected;
  const title = mode === 'create' ? '创建技能' : '编辑技能';
  const descriptionText =
    mode === 'create'
      ? '用自然语言描述工作流，检查即将创建的文件，然后保存。'
      : '更新这个技能，检查生成的文件变更，然后保存。';

  function validateBeforeReview(): string | null {
    if (!name.trim()) {
      return '请添加技能名称，方便识别这个工作流的用途。';
    }
    if (!description.trim()) {
      return '请添加简短描述，说明这个技能能帮助完成什么。';
    }
    if (!folderName.trim()) {
      return '请为这个技能选择文件夹名称。';
    }
    const folderNameError = validateSkillFolderName(folderName);
    if (folderNameError) {
      return folderNameError;
    }
    if (scope === 'project' && !effectiveProjectPath) {
      return '项目技能需要当前已打开项目。';
    }
    return null;
  }

  const handleMouseMove = useCallback((event: MouseEvent): void => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setSplitRatio(Math.min(0.75, Math.max(0.25, ratio)));
  }, []);

  const handleMouseUp = useCallback((): void => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleMouseMove, handleMouseUp, isResizing]);

  async function handleReview(): Promise<void> {
    const validationError = validateBeforeReview();
    if (validationError) {
      setMutationError(validationError);
      return;
    }
    setReviewLoading(true);
    setMutationError(null);
    try {
      const preview = await previewSkillUpsert(request);
      setReviewPreview(preview);
      setReviewOpen(true);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : '检查技能变更失败');
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleConfirmSave(): Promise<void> {
    setSaveLoading(true);
    setMutationError(null);
    try {
      const saved = await applySkillUpsert({
        ...request,
        reviewPlanId: reviewPreview?.planId,
      });
      setReviewOpen(false);
      onSaved(saved?.item.id ?? detail?.item.id ?? null);
      onClose();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : '保存技能失败');
    } finally {
      setSaveLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-6xl gap-0 overflow-hidden p-0">
          <div className="flex max-h-[85vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border px-6 py-5">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{descriptionText}</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-5">
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-text">1. 基础信息</h3>
                  <p className="text-sm text-text-muted">
                    给技能起一个清晰的名称，选择可用范围，并决定保存位置。
                  </p>
                </section>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="skill-scope">谁可以使用</Label>
                    <Select
                      value={scope}
                      onValueChange={(value) => setScope(value as 'user' | 'project')}
                      disabled={mode === 'edit'}
                    >
                      <SelectTrigger id="skill-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">个人</SelectItem>
                        <SelectItem value="project" disabled={!canUseProjectScope}>
                          {canUseProjectScope
                            ? `项目：${projectLabel ?? projectPath}`
                            : '当前无可用项目'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="skill-root">存储位置</Label>
                    <Select
                      value={rootKind}
                      onValueChange={(value) => setRootKind(value as SkillRootKind)}
                      disabled={mode === 'edit'}
                    >
                      <SelectTrigger id="skill-root">
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

                  <div className="space-y-2">
                    <Label htmlFor="skill-folder">文件夹名称</Label>
                    <Input
                      id="skill-folder"
                      value={folderName}
                      onChange={(event) => {
                        setFolderNameEdited(true);
                        setFolderName(event.target.value);
                      }}
                      disabled={mode === 'edit'}
                    />
                    {mode === 'create' && (
                      <p className="text-xs text-text-muted">
                        会根据技能名称自动建议，方便立即进入检查。
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="skill-invocation">使用方式</Label>
                    <Select
                      value={invocationMode}
                      onValueChange={(value) => {
                        const nextValue = value as SkillInvocationMode;
                        setInvocationMode(nextValue);
                        applyFormToRawContent({ invocationMode: nextValue });
                      }}
                    >
                      <SelectTrigger id="skill-invocation">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">可自动使用</SelectItem>
                        <SelectItem value="manual-only">仅在你明确要求时使用</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="skill-name">技能名称</Label>
                    <Input
                      id="skill-name"
                      value={name}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setName(nextValue);
                        if (mode === 'create' && !folderNameEdited) {
                          setFolderName(toSuggestedSkillFolderName(nextValue || '新技能'));
                        }
                        applyFormToRawContent({ name: nextValue });
                      }}
                      placeholder="填写简洁的技能名称"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="skill-license">许可证</Label>
                    <Input
                      id="skill-license"
                      value={license}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setLicense(nextValue);
                        applyFormToRawContent({ license: nextValue });
                      }}
                      placeholder="MIT"
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="skill-description">描述</Label>
                    <Input
                      id="skill-description"
                      value={description}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDescription(nextValue);
                        applyFormToRawContent({ description: nextValue });
                      }}
                      placeholder="这个技能能帮助完成什么"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="skill-compatibility">兼容性</Label>
                    <Input
                      id="skill-compatibility"
                      value={compatibility}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setCompatibility(nextValue);
                        applyFormToRawContent({ compatibility: nextValue });
                      }}
                      placeholder="claude-code, cursor"
                    />
                  </div>
                </div>

                {!customMarkdownDetected && (
                  <>
                    <section className="space-y-1">
                      <h3 className="text-sm font-semibold text-text">2. 使用说明</h3>
                      <p className="text-sm text-text-muted">
                        这些字段会自动生成技能文件；除非需要精细控制，否则不用手动编辑 Markdown。
                      </p>
                    </section>

                    <div className="grid gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="skill-when-to-use">何时使用</Label>
                        <Textarea
                          id="skill-when-to-use"
                          value={whenToUse}
                          disabled={instructionsLocked}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setWhenToUse(nextValue);
                            applyFormToRawContent({ whenToUse: nextValue });
                          }}
                          placeholder="示例：当任务是代码审查或缺陷排查时使用。"
                          className="min-h-[88px]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="skill-steps">主要步骤</Label>
                        <Textarea
                          id="skill-steps"
                          value={steps}
                          disabled={instructionsLocked}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setSteps(nextValue);
                            applyFormToRawContent({ steps: nextValue });
                          }}
                          placeholder={
                            '1. 检查相关文件。\n2. 先说明主要风险。\n3. 建议最稳妥的修复方式。'
                          }
                          className="min-h-[120px]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="skill-notes">补充说明或约束</Label>
                        <Textarea
                          id="skill-notes"
                          value={notes}
                          disabled={instructionsLocked}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setNotes(nextValue);
                            applyFormToRawContent({ notes: nextValue });
                          }}
                          placeholder="示例：指出缺失测试、回归风险和有风险的假设。"
                          className="min-h-[88px]"
                        />
                        {instructionsLocked && (
                          <p className="text-xs text-text-muted">
                            你已切换到下方手动编辑 `SKILL.md`，结构化字段已锁定。
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-text">3. 额外文件</h3>
                  <p className="text-sm text-text-muted">
                    仅在技能确实需要时添加辅助文档、脚本或素材。
                  </p>
                </section>

                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-text">可选文件</p>
                      <p className="mt-1 text-xs text-text-muted">
                        添加会随 `SKILL.md` 一起检查并写入的初始文件。
                      </p>
                    </div>
                    {mode === 'edit' && (
                      <Badge variant="outline" className="font-normal">
                        编辑时根目录和文件夹已锁定
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <label className="bg-surface-raised/10 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                      <Checkbox
                        checked={includeReferences}
                        onCheckedChange={(value) => setIncludeReferences(Boolean(value))}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-medium text-text">参考资料</p>
                        <p className="mt-1 text-xs text-text-muted">
                          添加运行时可以参考的文档、链接或示例。
                        </p>
                      </div>
                    </label>

                    <label className="bg-surface-raised/10 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                      <Checkbox
                        checked={includeScripts}
                        onCheckedChange={(value) => setIncludeScripts(Boolean(value))}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-medium text-text">脚本</p>
                        <p className="mt-1 text-xs text-text-muted">
                          添加辅助命令或安装说明。分享前请仔细检查。
                        </p>
                      </div>
                    </label>

                    <label className="bg-surface-raised/10 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                      <Checkbox
                        checked={includeAssets}
                        onCheckedChange={(value) => setIncludeAssets(Boolean(value))}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-medium text-text">素材</p>
                        <p className="mt-1 text-xs text-text-muted">
                          仅在有助于说明工作流时添加截图或媒体文件。
                        </p>
                      </div>
                    </label>
                  </div>

                  {auxiliaryDraftFilePaths.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                        已添加文件：
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {auxiliaryDraftFilePaths.map((filePath) => (
                          <Badge key={filePath} variant="outline" className="font-normal">
                            {filePath}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {mutationError && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
                    {mutationError}
                  </div>
                )}

                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-text">
                        {customMarkdownDetected ? '2. SKILL.md 编辑器' : '4. 高级 SKILL.md 编辑器'}
                      </h3>
                      <p className="text-sm text-text-muted">
                        {customMarkdownDetected
                          ? '这个技能使用自定义 Markdown 格式，请在这里直接编辑。'
                          : '通常可以跳过这里；只有需要直接控制原始 Markdown 文件时再打开。'}
                      </p>
                    </div>
                    {!customMarkdownDetected && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAdvancedEditor((prev) => !prev)}
                      >
                        {showAdvancedEditor ? '隐藏高级编辑器' : '显示高级编辑器'}
                      </Button>
                    )}
                  </div>

                  {showAdvancedEditor && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="skill-raw">SKILL.md</Label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setManualRawEdit(false);
                            setCustomMarkdownDetected(false);
                            const nextRawContent = buildSkillTemplate({
                              name,
                              description,
                              license,
                              compatibility,
                              invocationMode,
                              whenToUse,
                              steps,
                              notes,
                            });
                            rawContentRef.current = nextRawContent;
                            setRawContent(nextRawContent);
                          }}
                        >
                          <RotateCcw className="mr-1.5 size-3.5" />
                          从结构化字段重置
                        </Button>
                      </div>

                      <div
                        ref={containerRef}
                        className="flex h-[520px] min-h-0 overflow-hidden rounded-lg border border-border"
                      >
                        <div className="min-w-0" style={{ width: `${splitRatio * 100}%` }}>
                          <SkillCodeEditor
                            value={rawContent}
                            scrollRef={editorScrollRef}
                            onScroll={scrollSync.handleCodeScroll}
                            onChange={(value) => {
                              setManualRawEdit(true);
                              rawContentRef.current = value;
                              setRawContent(value);

                              const rawInput = readSkillTemplateContent(value);
                              setCustomMarkdownDetected(rawInput.hasUnstructuredBody);
                              if (rawInput.name !== undefined) setName(rawInput.name);
                              if (rawInput.description !== undefined)
                                setDescription(rawInput.description);
                              if (rawInput.license !== undefined) setLicense(rawInput.license);
                              if (rawInput.compatibility !== undefined)
                                setCompatibility(rawInput.compatibility);
                              if (rawInput.invocationMode !== undefined)
                                setInvocationMode(rawInput.invocationMode);
                              if (rawInput.whenToUse !== undefined)
                                setWhenToUse(rawInput.whenToUse);
                              if (rawInput.steps !== undefined) setSteps(rawInput.steps);
                              if (rawInput.notes !== undefined) setNotes(rawInput.notes);
                            }}
                          />
                        </div>
                        <div
                          className={`w-1 shrink-0 cursor-col-resize border-x border-border ${
                            isResizing ? 'bg-blue-500/50' : 'hover:bg-blue-500/30'
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setIsResizing(true);
                          }}
                        />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <MarkdownPreviewPane
                            content={rawContent}
                            baseDir={detail?.item.skillDir}
                            scrollRef={scrollSync.previewScrollRef}
                            onScroll={scrollSync.handlePreviewScroll}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-6 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
              <Button variant="outline" onClick={onClose}>
                <X className="mr-1.5 size-3.5" />
                取消
              </Button>
              <div className="min-w-64 flex-1">
                <p className="text-sm text-text-muted">请先检查文件变更，然后在下一步确认保存。</p>
                {mutationError && <p className="mt-1 text-sm text-red-400">{mutationError}</p>}
              </div>
              <Button onClick={() => void handleReview()} disabled={reviewLoading || saveLoading}>
                <FileSearch className="mr-1.5 size-3.5" />
                {reviewLoading ? '准备中...' : mode === 'create' ? '检查并创建' : '检查并保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SkillReviewDialog
        open={reviewOpen}
        preview={reviewPreview}
        loading={saveLoading}
        error={mutationError}
        onClose={() => setReviewOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        confirmLabel={mode === 'create' ? '创建技能' : '保存技能'}
        reviewLabel={mode === 'create' ? '正在创建技能' : '正在保存技能'}
      />
    </>
  );
};
