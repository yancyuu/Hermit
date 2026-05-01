import { useEffect, useMemo, useRef, useState } from 'react';

import {
  mergeCodexProviderStatusWithSnapshot,
  useCodexAccountSnapshot,
} from '@features/codex-account/renderer';
import { api } from '@renderer/api';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useStore } from '@renderer/store';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import {
  formatSkillRootKind,
  getSkillAudience,
  getSkillAudienceLabel,
  isCodexSkillOverlayAvailable,
} from '@shared/utils/skillRoots';
import {
  AlertTriangle,
  ArrowUpAZ,
  ArrowUpDown,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Info,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SearchInput } from '../common/SearchInput';

import { SkillDetailDialog } from './SkillDetailDialog';
import { SkillEditorDialog } from './SkillEditorDialog';
import { SkillImportDialog } from './SkillImportDialog';
import { resolveSkillProjectPath } from './skillProjectUtils';

import type { SkillsSortState } from '@renderer/hooks/useExtensionsTabState';
import type {
  SkillCatalogItem,
  SkillDetail,
  SkillSource,
  SkillValidationIssue,
} from '@shared/types/extensions';

const SUCCESS_BANNER_MS = 2500;
const NEW_SKILL_HIGHLIGHT_MS = 4000;
const USER_SKILLS_CATALOG_KEY = '__user__';
type SkillsQuickFilter = 'all' | 'project' | 'personal';

interface SkillsPanelProps {
  projectPath: string | null;
  projectLabel: string | null;
  skillsSearchQuery: string;
  setSkillsSearchQuery: (value: string) => void;
  skillsSort: SkillsSortState;
  setSkillsSort: (value: SkillsSortState) => void;
  selectedSkillId: string | null;
  setSelectedSkillId: (id: string | null) => void;
}

function sortSkills(skills: SkillCatalogItem[], sort: SkillsSortState): SkillCatalogItem[] {
  const next = [...skills];
  next.sort((a, b) => {
    if (sort === 'recent-desc') {
      return b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name) || b.modifiedAt - a.modifiedAt;
  });
  return next;
}

function getScopeLabel(skill: SkillCatalogItem): string {
  return skill.scope === 'project' ? '当前项目' : '个人';
}

function getInvocationLabel(skill: SkillCatalogItem): string {
  return skill.invocationMode === 'manual-only' ? '仅在你明确要求时运行' : '匹配任务时自动运行';
}

function getSkillStatus(skill: SkillCatalogItem): string {
  if (!skill.isValid) {
    return '使用前需要处理';
  }
  if (skill.flags.hasScripts) {
    return '包含脚本，请仔细检查';
  }
  return '可使用';
}

function getPrimarySkillIssue(skill: SkillCatalogItem): SkillValidationIssue | null {
  return (
    skill.issues.find((issue) => issue.severity === 'error') ??
    skill.issues.find((issue) => issue.severity === 'warning') ??
    skill.issues[0] ??
    null
  );
}

function getSkillIssueTone(issue: SkillValidationIssue | null): {
  className: string;
  Icon: typeof AlertTriangle;
} {
  if (issue?.severity === 'info') {
    return {
      className: 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300',
      Icon: Info,
    };
  }

  return {
    className: 'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    Icon: AlertTriangle,
  };
}

export const SkillsPanel = ({
  projectPath,
  projectLabel,
  skillsSearchQuery,
  setSkillsSearchQuery,
  skillsSort,
  setSkillsSort,
  selectedSkillId,
  setSelectedSkillId,
}: SkillsPanelProps): React.JSX.Element => {
  const catalogKey = projectPath ?? USER_SKILLS_CATALOG_KEY;
  const fetchSkillsCatalog = useStore((s) => s.fetchSkillsCatalog);
  const fetchSkillDetail = useStore((s) => s.fetchSkillDetail);
  const cliStatus = useStore((s) => s.cliStatus);
  const cliStatusLoading = useStore((s) => s.cliStatusLoading);
  const multimodelEnabled = useStore((s) => s.appConfig?.general?.multimodelEnabled ?? false);
  const skillsLoading = useStore((s) => s.skillsCatalogLoadingByProjectPath[catalogKey] ?? false);
  const skillsError = useStore((s) => s.skillsCatalogErrorByProjectPath[catalogKey] ?? null);
  const detailById = useStore(useShallow((s) => s.skillsDetailsById));
  const userSkills = useStore(useShallow((s) => s.skillsUserCatalog));
  const projectSkills = useStore(
    useShallow((s) => (projectPath ? (s.skillsProjectCatalogByProjectPath[projectPath] ?? []) : []))
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingDetail, setEditingDetail] = useState<SkillDetail | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<SkillsQuickFilter>('all');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [highlightedSkillId, setHighlightedSkillId] = useState<string | null>(null);
  const [skillSources, setSkillSources] = useState<SkillSource[]>([]);
  const [newSkillSourceUrl, setNewSkillSourceUrl] = useState('');
  const [skillSourceLoading, setSkillSourceLoading] = useState(false);
  const [skillSourceError, setSkillSourceError] = useState<string | null>(null);
  const selectedSkillIdRef = useRef<string | null>(selectedSkillId);
  const selectedSkillItemRef = useRef<SkillCatalogItem | null>(null);
  selectedSkillIdRef.current = selectedSkillId;
  const loadingCliStatus = useMemo(
    () =>
      !cliStatus && cliStatusLoading && multimodelEnabled
        ? createLoadingMultimodelCliStatus()
        : cliStatus,
    [cliStatus, cliStatusLoading, multimodelEnabled]
  );
  const codexAccount = useCodexAccountSnapshot({
    enabled:
      loadingCliStatus?.flavor === 'agent_teams_orchestrator' &&
      Boolean(loadingCliStatus?.providers.some((provider) => provider.providerId === 'codex')),
  });
  const effectiveCliStatus = useMemo(
    () =>
      loadingCliStatus
        ? {
            ...loadingCliStatus,
            providers: loadingCliStatus.providers.map((provider) =>
              provider.providerId === 'codex'
                ? mergeCodexProviderStatusWithSnapshot(provider, codexAccount.snapshot)
                : provider
            ),
          }
        : loadingCliStatus,
    [loadingCliStatus, codexAccount.snapshot]
  );

  const mergedSkills = useMemo(
    () => [...projectSkills, ...userSkills],
    [projectSkills, userSkills]
  );
  const codexSkillOverlayAvailable = useMemo(
    () => isCodexSkillOverlayAvailable(effectiveCliStatus),
    [effectiveCliStatus]
  );
  const selectedDetail = selectedSkillId ? (detailById[selectedSkillId] ?? null) : null;
  selectedSkillItemRef.current = selectedSkillId
    ? (selectedDetail?.item ?? mergedSkills.find((skill) => skill.id === selectedSkillId) ?? null)
    : null;

  useEffect(() => {
    if (!selectedSkillId) return;
    if (mergedSkills.some((skill) => skill.id === selectedSkillId)) return;
    setSelectedSkillId(null);
  }, [mergedSkills, selectedSkillId, setSelectedSkillId]);

  useEffect(() => {
    if (!successMessage) return;
    const timeoutId = window.setTimeout(() => setSuccessMessage(null), SUCCESS_BANNER_MS);
    return () => window.clearTimeout(timeoutId);
  }, [successMessage]);

  useEffect(() => {
    if (!highlightedSkillId) return;
    const timeoutId = window.setTimeout(() => setHighlightedSkillId(null), NEW_SKILL_HIGHLIGHT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [highlightedSkillId]);

  useEffect(() => {
    const skillsApi = api.skills;
    if (!skillsApi) return;

    let watchId: string | null = null;
    let disposed = false;
    void skillsApi.startWatching(projectPath ?? undefined).then((id) => {
      if (disposed) {
        void skillsApi.stopWatching(id);
        return;
      }
      watchId = id;
    });
    const changeCleanup = skillsApi.onChanged((event) => {
      const shouldRefresh =
        event.scope === 'user' ||
        (event.scope === 'project' && event.projectPath === (projectPath ?? null));
      if (!shouldRefresh) return;

      void fetchSkillsCatalog(projectPath ?? undefined);
      const selectedSkillId = selectedSkillIdRef.current;
      const selectedSkillItem = selectedSkillItemRef.current;
      if (selectedSkillId) {
        void fetchSkillDetail(
          selectedSkillId,
          selectedSkillItem
            ? resolveSkillProjectPath(
                selectedSkillItem.scope,
                projectPath,
                selectedSkillItem.projectRoot
              )
            : (projectPath ?? undefined)
        ).catch(() => undefined);
      }
    });

    return () => {
      disposed = true;
      changeCleanup();
      if (watchId) {
        void skillsApi.stopWatching(watchId);
      }
    };
  }, [fetchSkillDetail, fetchSkillsCatalog, projectPath]);

  useEffect(() => {
    if (!api.skills) return;
    void api.skills
      .listSources()
      .then((snapshot) => setSkillSources(snapshot.sources))
      .catch(() => undefined);
  }, []);

  const saveAndRefreshSkillSources = async (sources: SkillSource[]): Promise<void> => {
    if (!api.skills) return;
    setSkillSourceLoading(true);
    setSkillSourceError(null);
    try {
      const saved = await api.skills.saveSources(sources);
      setSkillSources(saved.sources);
      const refreshed = await api.skills.refreshSources();
      setSkillSources(refreshed.sources);
      await fetchSkillsCatalog(projectPath ?? undefined);
      setSuccessMessage('Skills 源已同步到 ~/.hermit/skills');
    } catch (error) {
      setSkillSourceError(error instanceof Error ? error.message : '同步 Skills 源失败');
    } finally {
      setSkillSourceLoading(false);
    }
  };

  const handleAddSkillSource = async (): Promise<void> => {
    const url = newSkillSourceUrl.trim();
    if (!url) return;
    const id =
      url
        .replace(/\.git$/, '')
        .split(/[/:]/)
        .filter(Boolean)
        .slice(-2)
        .join('-')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-') || `source-${Date.now().toString(36)}`;
    await saveAndRefreshSkillSources([
      ...skillSources,
      { id, name: id, url, enabled: true, branch: 'main' },
    ]);
    setNewSkillSourceUrl('');
  };

  const handleRemoveSkillSource = async (sourceId: string): Promise<void> => {
    await saveAndRefreshSkillSources(skillSources.filter((source) => source.id !== sourceId));
  };

  const visibleSkills = useMemo(() => {
    const q = skillsSearchQuery.trim().toLowerCase();
    const filteredByQuery = q
      ? mergedSkills.filter(
          (skill) =>
            skill.name.toLowerCase().includes(q) ||
            skill.description.toLowerCase().includes(q) ||
            skill.folderName.toLowerCase().includes(q)
        )
      : mergedSkills;
    const filtered =
      quickFilter === 'all'
        ? filteredByQuery
        : filteredByQuery.filter((skill) => {
            switch (quickFilter) {
              case 'project':
                return skill.scope === 'project';
              case 'personal':
                return skill.scope === 'user';
              default:
                return true;
            }
          });
    return sortSkills(filtered, skillsSort);
  }, [mergedSkills, quickFilter, skillsSearchQuery, skillsSort]);
  const visibleProjectSkills = useMemo(
    () => visibleSkills.filter((skill) => skill.scope === 'project'),
    [visibleSkills]
  );
  const visibleUserSkills = useMemo(
    () => visibleSkills.filter((skill) => skill.scope === 'user'),
    [visibleSkills]
  );
  const isRefreshing = skillsLoading && mergedSkills.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {effectiveCliStatus?.flavor === 'agent_teams_orchestrator' && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-300">
          全局技能由 `~/.hermit/skills` 管理，并在团队启动前投影到各 runtime 的全局 skills
          目录。项目技能直接安装到你选择的项目 runtime 目录。
        </div>
      )}
      <div className="bg-surface-raised/20 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-semibold text-text">全局 Skills 源</h3>
            <p className="text-xs text-text-muted">
              Git 源会同步到 `~/.hermit/skills`，随后由 Hermit 投影给 Claude、Cursor、Codex
              等运行时。
            </p>
            <p className="text-xs text-text-muted">
              打开面板只读取本地缓存；只有点击“添加并同步”或“刷新源”才会访问 GitHub 更新。
            </p>
            <input
              value={newSkillSourceUrl}
              onChange={(event) => setNewSkillSourceUrl(event.target.value)}
              placeholder="https://github.com/yancyuu/HermitSkills"
              className="mt-2 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-text"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={skillSourceLoading || !newSkillSourceUrl.trim()}
            onClick={() => void handleAddSkillSource()}
          >
            {skillSourceLoading ? '同步中...' : '添加并同步'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={skillSourceLoading || skillSources.length === 0}
            onClick={() => void saveAndRefreshSkillSources(skillSources)}
          >
            刷新源
          </Button>
        </div>
        {skillSourceError ? <p className="mt-2 text-xs text-red-400">{skillSourceError}</p> : null}
        {skillSources.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {skillSources.map((source) => (
              <span
                key={source.id}
                className="inline-flex max-w-full items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted"
                title={source.url}
              >
                <span className="max-w-44 truncate">
                  {source.name}
                  {source.lastError ? ' · 同步失败' : ''}
                </span>
                <button
                  type="button"
                  className="-mr-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded hover:bg-red-500/10 hover:text-red-300"
                  onClick={() => void handleRemoveSkillSource(source.id)}
                  aria-label={`删除 Skills 源 ${source.name}`}
                >
                  <Trash2 size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="bg-surface-raised/20 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-1 xl:max-w-2xl">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-text-muted" />
              <h2 className="text-sm font-semibold text-text">教授可重复工作</h2>
            </div>
            <p className="max-w-2xl text-sm leading-5 text-text-muted">
              技能是可复用指令，能帮助运行时更稳定地处理同一类任务。{' '}
              {projectPath
                ? `当前显示 ${projectLabel ?? projectPath} 的项目技能，以及你的个人技能。`
                : '当前只显示你的个人技能。'}
            </p>
            <p className="max-w-2xl text-xs leading-5 text-text-muted">
              需要到处生效的习惯请使用个人技能；只对当前代码库有意义的流程请使用项目技能。
              全局技能从 Hermit 源统一投影；项目技能直接写入所选项目 runtime 目录。
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[32rem] xl:max-w-[40rem]">
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center xl:justify-end">
              <div className="w-full lg:min-w-72 lg:flex-1 xl:w-80 xl:flex-none">
                <SearchInput
                  value={skillsSearchQuery}
                  onChange={setSkillsSearchQuery}
                  placeholder="按技能名称或用途搜索..."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 size-3.5" />
                  创建技能
                </Button>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <Download className="mr-1.5 size-3.5" />
                  导入
                </Button>
                <Popover open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9 shrink-0"
                          aria-label="排序技能"
                        >
                          <ArrowUpDown className="size-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>排序技能</TooltipContent>
                  </Tooltip>
                  <PopoverContent align="end" className="w-44 p-1">
                    <button
                      type="button"
                      className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-text hover:bg-surface-raised"
                      onClick={() => {
                        setSkillsSort('name-asc');
                        setSortMenuOpen(false);
                      }}
                    >
                      <ArrowUpAZ className="mr-2 size-3.5" />
                      名称
                      {skillsSort === 'name-asc' && <Check className="ml-auto size-3.5" />}
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-text hover:bg-surface-raised"
                      onClick={() => {
                        setSkillsSort('recent-desc');
                        setSortMenuOpen(false);
                      }}
                    >
                      <Clock3 className="mr-2 size-3.5" />
                      最近
                      {skillsSort === 'recent-desc' && <Check className="ml-auto size-3.5" />}
                    </button>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] text-text-muted xl:justify-end">
              <Badge variant="secondary" className="font-normal">
                共 {mergedSkills.length} 个
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {projectSkills.length} 个项目技能
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {userSkills.length} 个个人技能
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', '全部技能'],
            ['project', '项目'],
            ['personal', '个人'],
          ] as [SkillsQuickFilter, string][]
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={quickFilter === value ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setQuickFilter(value)}
            className="rounded-full"
          >
            {label}
          </Button>
        ))}
      </div>

      {skillsError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
          {skillsError}
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {isRefreshing && (
        <div className="rounded-md border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
          正在刷新技能...
        </div>
      )}

      {skillsLoading && visibleSkills.length === 0 && (
        <div className="rounded-lg border border-border p-6 text-sm text-text-muted">
          正在加载技能...
        </div>
      )}

      {!skillsLoading && !skillsError && visibleSkills.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-sm border border-dashed border-border px-8 py-16">
          <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-raised">
            <Search className="size-5 text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary">
            {skillsSearchQuery ? '没有匹配搜索的技能' : '暂无技能'}
          </p>
          <p className="text-xs text-text-muted">
            {skillsSearchQuery
              ? '请尝试其他搜索词或切换筛选条件。'
              : '创建第一个技能来教授可重复工作流，或导入你已有的技能。'}
          </p>
        </div>
      )}

      {visibleSkills.length > 0 && (
        <div className="space-y-6">
          {visibleProjectSkills.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-text">项目技能</h3>
                  <p className="text-xs text-text-muted">只对当前代码库有意义的工作流。</p>
                </div>
                <Badge variant="secondary" className="font-normal">
                  {visibleProjectSkills.length}
                </Badge>
              </div>
              <div className="skills-grid grid grid-cols-1 gap-3 xl:grid-cols-2">
                {visibleProjectSkills.map((skill) => {
                  const primaryIssue = getPrimarySkillIssue(skill);
                  const issueTone = getSkillIssueTone(primaryIssue);
                  const IssueIcon = issueTone.Icon;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setSelectedSkillId(skill.id)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        highlightedSkillId === skill.id
                          ? 'border-green-500/50 bg-green-500/10 shadow-[0_0_0_1px_rgba(34,197,94,0.18)]'
                          : 'bg-surface-raised/10 border-border hover:border-border-emphasis'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-text">
                              {skill.name}
                            </h3>
                            {!skill.isValid && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 text-amber-700 dark:text-amber-300"
                              >
                                需要处理
                              </Badge>
                            )}
                          </div>
                          <p className="line-clamp-2 text-sm text-text-secondary">
                            {skill.description}
                          </p>
                        </div>
                        <Badge variant="outline">{getScopeLabel(skill)}</Badge>
                      </div>

                      <div className="mt-3 space-y-2 text-xs text-text-muted">
                        <p>{getInvocationLabel(skill)}</p>
                        <p>{getSkillStatus(skill)}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="secondary" className="font-normal">
                          存储于 {formatSkillRootKind(skill.rootKind)}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          {getSkillAudienceLabel(skill.rootKind)}
                        </Badge>
                        {skill.flags.hasScripts && (
                          <Badge variant="destructive" className="font-normal">
                            包含脚本
                          </Badge>
                        )}
                        {skill.flags.hasReferences && (
                          <Badge variant="secondary" className="font-normal">
                            引用
                          </Badge>
                        )}
                        {skill.flags.hasAssets && (
                          <Badge variant="secondary" className="font-normal">
                            资源
                          </Badge>
                        )}
                      </div>

                      {primaryIssue && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${issueTone.className}`}
                        >
                          <IssueIcon className="mt-0.5 size-3.5 shrink-0" />
                          <span>{primaryIssue.message}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {visibleUserSkills.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-text">个人技能</h3>
                  <p className="text-xs text-text-muted">需要在所有地方可用的习惯和指令。</p>
                </div>
                <Badge variant="secondary" className="font-normal">
                  {visibleUserSkills.length}
                </Badge>
              </div>
              <div className="skills-grid grid grid-cols-1 gap-3 xl:grid-cols-2">
                {visibleUserSkills.map((skill) => {
                  const primaryIssue = getPrimarySkillIssue(skill);
                  const issueTone = getSkillIssueTone(primaryIssue);
                  const IssueIcon = issueTone.Icon;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setSelectedSkillId(skill.id)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        highlightedSkillId === skill.id
                          ? 'border-green-500/50 bg-green-500/10 shadow-[0_0_0_1px_rgba(34,197,94,0.18)]'
                          : 'bg-surface-raised/10 border-border hover:border-border-emphasis'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-text">
                              {skill.name}
                            </h3>
                            {!skill.isValid && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 text-amber-700 dark:text-amber-300"
                              >
                                需要处理
                              </Badge>
                            )}
                          </div>
                          <p className="line-clamp-2 text-sm text-text-secondary">
                            {skill.description}
                          </p>
                        </div>
                        <Badge variant="outline">{getScopeLabel(skill)}</Badge>
                      </div>

                      <div className="mt-3 space-y-2 text-xs text-text-muted">
                        <p>{getInvocationLabel(skill)}</p>
                        <p>{getSkillStatus(skill)}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="secondary" className="font-normal">
                          存储于 {formatSkillRootKind(skill.rootKind)}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          {getSkillAudienceLabel(skill.rootKind)}
                        </Badge>
                        {skill.flags.hasScripts && (
                          <Badge variant="destructive" className="font-normal">
                            包含脚本
                          </Badge>
                        )}
                        {skill.flags.hasReferences && (
                          <Badge variant="secondary" className="font-normal">
                            引用
                          </Badge>
                        )}
                        {skill.flags.hasAssets && (
                          <Badge variant="secondary" className="font-normal">
                            资源
                          </Badge>
                        )}
                      </div>

                      {primaryIssue && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${issueTone.className}`}
                        >
                          <IssueIcon className="mt-0.5 size-3.5 shrink-0" />
                          <span>{primaryIssue.message}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      <SkillDetailDialog
        skillId={selectedSkillId}
        open={selectedSkillId !== null}
        onClose={() => setSelectedSkillId(null)}
        projectPath={projectPath}
        onEdit={() => {
          if (!selectedDetail) return;
          setEditingDetail(selectedDetail);
          setSelectedSkillId(null);
          setEditOpen(true);
        }}
        onDeleted={() => setSelectedSkillId(null)}
      />

      <SkillEditorDialog
        open={createOpen}
        mode="create"
        projectPath={projectPath}
        projectLabel={projectLabel}
        allowCodexRootKind={codexSkillOverlayAvailable}
        detail={null}
        onClose={() => setCreateOpen(false)}
        onSaved={(skillId) => {
          setCreateOpen(false);
          setSuccessMessage('技能创建成功。');
          setHighlightedSkillId(skillId);
          setSelectedSkillId(null);
        }}
      />

      <SkillEditorDialog
        open={editOpen}
        mode="edit"
        projectPath={projectPath}
        projectLabel={projectLabel}
        allowCodexRootKind={codexSkillOverlayAvailable}
        detail={editingDetail}
        onClose={() => {
          setEditOpen(false);
          setEditingDetail(null);
        }}
        onSaved={(skillId) => {
          setEditOpen(false);
          setEditingDetail(null);
          setSuccessMessage('技能保存成功。');
          setSelectedSkillId(skillId);
        }}
      />

      <SkillImportDialog
        open={importOpen}
        projectPath={projectPath}
        projectLabel={projectLabel}
        allowCodexRootKind={codexSkillOverlayAvailable}
        onClose={() => setImportOpen(false)}
        onImported={(skillId) => {
          setImportOpen(false);
          setSuccessMessage('技能导入成功。');
          setSelectedSkillId(skillId);
        }}
      />
    </div>
  );
};
