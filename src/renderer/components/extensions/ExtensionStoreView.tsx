/**
 * ExtensionStoreView — top-level component for the Extensions tab.
 * Uses per-tab UI state via useExtensionsTabState() hook.
 * Global catalog data comes from Zustand store.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  mergeCodexProviderStatusWithSnapshot,
  useCodexAccountSnapshot,
} from '@features/codex-account/renderer';
import { api, isElectronMode } from '@renderer/api';
import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Tabs, TabsContent, TabsList } from '@renderer/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { useTabIdOptional } from '@renderer/contexts/useTabUIContext';
import { useExtensionsTabState } from '@renderer/hooks/useExtensionsTabState';
import { useStore } from '@renderer/store';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import {
  formatCliExtensionCapabilityStatus,
  getVisibleMultimodelProviders,
  isMultimodelRuntimeStatus,
} from '@renderer/utils/multimodelProviderVisibility';
import { resolveProjectPathById } from '@renderer/utils/projectLookup';
import { refreshCliStatusForCurrentMode } from '@renderer/utils/refreshCliStatus';
import { getRuntimeDisplayName } from '@renderer/utils/runtimeDisplayName';
import { getExtensionActionDisableReason } from '@shared/utils/extensionNormalizers';
import { getCliProviderExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';
import {
  AlertTriangle,
  BookOpen,
  Info,
  Key,
  Loader2,
  Plus,
  Puzzle,
  RefreshCw,
  Server,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ApiKeysPanel } from './apikeys/ApiKeysPanel';
import { CustomMcpServerDialog } from './mcp/CustomMcpServerDialog';
import { McpServersPanel } from './mcp/McpServersPanel';
import { PluginsPanel } from './plugins/PluginsPanel';
import { SkillsPanel } from './skills/SkillsPanel';
import { ExtensionsSubTabTrigger } from './ExtensionsSubTabTrigger';

import type { CliProviderStatus } from '@shared/types';

const ProviderCapabilityCardSkeleton = ({
  providerId,
  displayName,
}: {
  providerId: 'anthropic' | 'codex' | 'gemini' | 'opencode';
  displayName: string;
}): React.JSX.Element => (
  <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-text">
          <ProviderBrandLogo providerId={providerId} className="size-4 shrink-0" />
          <span>{displayName}</span>
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
          <Loader2 className="size-3 animate-spin" />
          <span>正在检查提供商状态...</span>
        </div>
      </div>
      <Badge variant="outline" className="shrink-0 text-text-muted">
        加载中...
      </Badge>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {Array.from({ length: 3 }, (_, index) => (
        <span
          key={index}
          className="h-7 w-28 animate-pulse rounded-md border border-border bg-surface"
        />
      ))}
    </div>
  </div>
);

function isProviderCapabilityCardLoading(
  provider: CliProviderStatus,
  providerLoading: boolean
): boolean {
  return (
    providerLoading ||
    (!provider.authenticated &&
      provider.statusMessage === 'Checking...' &&
      provider.models.length === 0 &&
      provider.backend == null)
  );
}

function isCodexSnapshotPending(
  provider: CliProviderStatus,
  codexSnapshotPending: boolean
): boolean {
  return provider.providerId === 'codex' && codexSnapshotPending;
}

export const ExtensionStoreView = (): React.JSX.Element => {
  const isElectron = useMemo(() => isElectronMode(), []);
  const tabId = useTabIdOptional();
  const {
    fetchPluginCatalog,
    bootstrapCliStatus,
    fetchCliStatus,
    fetchApiKeys,
    fetchSkillsCatalog,
    mcpBrowse,
    mcpFetchInstalled,
    apiKeysLoading,
    pluginCatalogLoading,
    mcpBrowseLoading,
    skillsLoading,
    cliStatus,
    cliStatusLoading,
    cliProviderStatusLoading,
    appConfig,
    openDashboard,
    sessions,
    projects,
    repositoryGroups,
  } = useStore(
    useShallow((s) => ({
      fetchPluginCatalog: s.fetchPluginCatalog,
      bootstrapCliStatus: s.bootstrapCliStatus,
      fetchCliStatus: s.fetchCliStatus,
      fetchApiKeys: s.fetchApiKeys,
      fetchSkillsCatalog: s.fetchSkillsCatalog,
      mcpBrowse: s.mcpBrowse,
      mcpFetchInstalled: s.mcpFetchInstalled,
      apiKeysLoading: s.apiKeysLoading,
      pluginCatalogLoading: s.pluginCatalogLoading,
      mcpBrowseLoading: s.mcpBrowseLoading,
      skillsLoading: s.skillsLoading,
      cliStatus: s.cliStatus,
      cliStatusLoading: s.cliStatusLoading,
      cliProviderStatusLoading: s.cliProviderStatusLoading,
      appConfig: s.appConfig,
      openDashboard: s.openDashboard,
      sessions: s.sessions,
      projects: s.projects,
      repositoryGroups: s.repositoryGroups,
    }))
  );
  const multimodelEnabled = appConfig?.general?.multimodelEnabled ?? true;
  const loadingCliStatus = useMemo(
    () =>
      !cliStatus && cliStatusLoading && multimodelEnabled
        ? createLoadingMultimodelCliStatus()
        : cliStatus,
    [cliStatus, cliStatusLoading, multimodelEnabled]
  );
  const codexAccount = useCodexAccountSnapshot({
    enabled:
      isElectron &&
      multimodelEnabled &&
      loadingCliStatus?.flavor === 'agent_teams_orchestrator' &&
      Boolean(
        loadingCliStatus?.providers.some(
          (provider: CliProviderStatus) => provider.providerId === 'codex'
        )
      ),
    includeRateLimits: true,
  });
  const codexSnapshotPending =
    codexAccount.loading &&
    Boolean(
      loadingCliStatus?.providers.some(
        (provider: CliProviderStatus) => provider.providerId === 'codex'
      )
    ) &&
    !codexAccount.snapshot;
  const effectiveCliStatus = useMemo(
    () =>
      loadingCliStatus
        ? {
            ...loadingCliStatus,
            providers: loadingCliStatus.providers.map((provider: CliProviderStatus) =>
              provider.providerId === 'codex'
                ? mergeCodexProviderStatusWithSnapshot(provider, codexAccount.snapshot)
                : provider
            ),
          }
        : loadingCliStatus,
    [loadingCliStatus, codexAccount.snapshot]
  );
  const effectiveCliStatusLoading = cliStatusLoading && effectiveCliStatus === null;
  const runtimeDisplayName = getRuntimeDisplayName(effectiveCliStatus, multimodelEnabled);
  const cliInstalled = effectiveCliStatus?.installed ?? true;
  const hasOngoingSessions = sessions.some((sess) => sess.isOngoing);
  const extensionsTabProjectId = useStore((s) =>
    tabId
      ? (s.paneLayout.panes.flatMap((pane) => pane.tabs).find((tab) => tab.id === tabId)
          ?.projectId ?? null)
      : null
  );

  const tabState = useExtensionsTabState();
  const [customMcpDialogOpen, setCustomMcpDialogOpen] = useState(false);
  const resolvedProject = useMemo(
    () => resolveProjectPathById(extensionsTabProjectId, projects, repositoryGroups),
    [extensionsTabProjectId, projects, repositoryGroups]
  );
  const projectPath = resolvedProject?.path ?? null;
  const projectLabel = resolvedProject?.name ?? null;
  const subTabs = useMemo(
    () => [
      {
        value: 'plugins' as const,
        label: '插件',
        icon: Puzzle,
        description:
          '运行时的小型扩展。多模型模式下，目前在支持时主要作用于 Anthropic 会话，更广泛的提供商支持正在开发中。',
      },
      {
        value: 'mcp-servers' as const,
        label: 'MCP 服务器',
        icon: Server,
        description: '连接外部工具和应用，让运行时可以读取数据或执行本应用之外的操作。',
      },
      {
        value: 'skills' as const,
        label: '技能',
        icon: BookOpen,
        description: '面向常见任务的可复用指令，帮助运行时更稳定地处理重复工作。',
      },
      {
        value: 'api-keys' as const,
        label: 'API 密钥',
        icon: Key,
        description: '在线服务的密钥。添加后，插件、服务器和集成即可连接并工作。',
      },
    ],
    []
  );

  // Fetch plugin catalog on mount
  useEffect(() => {
    void fetchPluginCatalog(projectPath ?? undefined);
  }, [fetchPluginCatalog, projectPath]);

  useEffect(() => {
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
  }, [bootstrapCliStatus, fetchCliStatus, multimodelEnabled]);

  // Fetch MCP installed state on mount
  useEffect(() => {
    void mcpFetchInstalled(projectPath ?? undefined);
  }, [mcpFetchInstalled, projectPath]);

  // Fetch API keys on mount
  useEffect(() => {
    void fetchApiKeys();
  }, [fetchApiKeys]);

  // Fetch Skills catalog on mount / project change
  useEffect(() => {
    void fetchSkillsCatalog(projectPath ?? undefined);
  }, [fetchSkillsCatalog, projectPath]);

  // Refresh all data (plugins + MCP browse + installed + skills)
  const handleRefresh = useCallback(() => {
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
    void fetchApiKeys();
    void fetchPluginCatalog(projectPath ?? undefined, true);
    void mcpBrowse(); // re-fetch first page
    void mcpFetchInstalled(projectPath ?? undefined);
    void fetchSkillsCatalog(projectPath ?? undefined);
  }, [
    bootstrapCliStatus,
    fetchApiKeys,
    fetchCliStatus,
    fetchPluginCatalog,
    fetchSkillsCatalog,
    multimodelEnabled,
    mcpBrowse,
    mcpFetchInstalled,
    projectPath,
  ]);

  const isRefreshing =
    effectiveCliStatusLoading ||
    apiKeysLoading ||
    pluginCatalogLoading ||
    mcpBrowseLoading ||
    skillsLoading;
  const mcpMutationDisableReason = useMemo(
    () =>
      getExtensionActionDisableReason({
        isInstalled: false,
        cliStatus: effectiveCliStatus,
        cliStatusLoading: effectiveCliStatusLoading,
        section: 'mcp',
      }),
    [effectiveCliStatus, effectiveCliStatusLoading]
  );
  const cliStatusBanner = useMemo(() => {
    const providers = effectiveCliStatus?.providers ?? [];
    const visibleProviders = getVisibleMultimodelProviders(providers);
    const isMultimodel = isMultimodelRuntimeStatus(effectiveCliStatus);
    const shouldShowMultimodelProviderCards =
      isMultimodel && visibleProviders.length > 0 && effectiveCliStatus !== null;

    if (
      (effectiveCliStatusLoading || effectiveCliStatus === null) &&
      !shouldShowMultimodelProviderCards
    ) {
      return (
        <div className="bg-surface/70 mx-4 mt-3 flex items-start gap-3 rounded-md border border-border px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-text-secondary" />
          <div>
            <p className="text-sm font-medium text-text">正在检查扩展运行时可用性</p>
            <p className="mt-0.5 text-xs text-text-muted">
              扩展需要配置好的运行时来管理插件、MCP 服务器、技能和提供商连接。
            </p>
          </div>
        </div>
      );
    }

    if (!effectiveCliStatus.installed) {
      const cliLaunchIssue = Boolean(
        effectiveCliStatus.binaryPath && effectiveCliStatus.launchError
      );
      return (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-300">
              {cliLaunchIssue ? '已找到配置的运行时，但启动失败' : '配置的运行时不可用'}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {cliLaunchIssue
                ? '运行时通过启动健康检查之前，扩展功能会保持禁用。请前往首页修复或重新安装。'
                : '安装运行时之前，扩展功能会保持禁用。请前往首页安装后重试。'}
            </p>
            {cliLaunchIssue && effectiveCliStatus.launchError && (
              <p className="mt-2 break-all font-mono text-[11px] text-text-muted">
                {effectiveCliStatus.launchError}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={openDashboard}>
            打开首页
          </Button>
        </div>
      );
    }

    if (!isMultimodel && !effectiveCliStatus.authLoggedIn) {
      return (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-300">{runtimeDisplayName} 需要登录</p>
            <p className="mt-0.5 text-xs text-text-muted">
              已找到 {runtimeDisplayName}
              {effectiveCliStatus.installedVersion
                ? ` (${effectiveCliStatus.installedVersion})`
                : ''}
              ，但登录前无法安装插件。请前往首页登录。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={openDashboard}>
            打开首页
          </Button>
        </div>
      );
    }

    if (isMultimodel) {
      return (
        <div className="bg-surface/70 mx-4 mt-3 rounded-md border border-border px-4 py-3">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 size-4 shrink-0 text-text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">多模型运行时能力</p>
              <p className="mt-0.5 text-xs text-text-muted">
                不同区域支持的提供商可能不同。只有运行时明确声明支持时，插件才会显示。
              </p>
            </div>
          </div>
          {visibleProviders.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {visibleProviders.map((provider) => {
                const providerLoading = cliProviderStatusLoading[provider.providerId] === true;
                if (
                  isProviderCapabilityCardLoading(provider, providerLoading) ||
                  isCodexSnapshotPending(provider, codexSnapshotPending)
                ) {
                  return (
                    <ProviderCapabilityCardSkeleton
                      key={provider.providerId}
                      providerId={provider.providerId}
                      displayName={provider.displayName}
                    />
                  );
                }

                const statusTone = provider.authenticated
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                  : provider.supported
                    ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
                    : 'border-border bg-surface-raised text-text-muted';
                const statusLabel = provider.authenticated
                  ? '已连接'
                  : provider.supported
                    ? '需要设置'
                    : '不支持';
                const extensionCapabilities = getCliProviderExtensionCapabilities(provider);
                const pluginStatus = extensionCapabilities.plugins.status;

                return (
                  <div
                    key={provider.providerId}
                    className={`rounded-md border px-3 py-2 ${statusTone}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-2 text-sm font-medium">
                          <ProviderBrandLogo
                            providerId={provider.providerId}
                            className="size-4 shrink-0"
                          />
                          <span>{provider.displayName}</span>
                        </p>
                        <p className="truncate text-[11px] text-text-muted">
                          {provider.statusMessage ?? provider.backend?.label ?? '可配置'}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <Badge
                        variant={pluginStatus === 'unsupported' ? 'outline' : 'secondary'}
                        className={
                          pluginStatus === 'unsupported'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : undefined
                        }
                      >
                        插件：{formatCliExtensionCapabilityStatus(pluginStatus)}
                      </Badge>
                      <Badge variant="secondary">
                        MCP: {formatCliExtensionCapabilityStatus(extensionCapabilities.mcp.status)}
                      </Badge>
                      <Badge variant="secondary">
                        技能：{extensionCapabilities.skills.ownership}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-emerald-300" />
        <div>
          <p className="text-sm font-medium text-emerald-300">{runtimeDisplayName} 已就绪</p>
          <p className="mt-0.5 text-xs text-text-muted">
            可以从此页面安装插件
            {effectiveCliStatus.installedVersion
              ? `，使用 ${runtimeDisplayName} ${effectiveCliStatus.installedVersion}`
              : ''}
            .
          </p>
        </div>
      </div>
    );
  }, [
    cliProviderStatusLoading,
    codexSnapshotPending,
    effectiveCliStatus,
    effectiveCliStatusLoading,
    openDashboard,
  ]);

  // Browser mode guard
  if (!api.plugins && !api.mcpRegistry && !api.skills) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Puzzle className="mx-auto mb-3 size-12 text-text-muted" />
          <h2 className="text-lg font-semibold text-text">扩展</h2>
          <p className="mt-1 text-sm text-text-muted">仅桌面应用可用。</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {cliStatusBanner}
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Puzzle className="size-5 text-text-muted" />
              <h1 className="text-lg font-semibold text-text">扩展</h1>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing}>
                  <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>刷新目录</TooltipContent>
            </Tooltip>
          </div>

          {/* Sub-tabs */}
          <div className="px-6 py-4">
            {/* CLI not installed warning */}
            {!cliInstalled && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
                <AlertTriangle className="size-4 shrink-0" />
                安装或卸载扩展需要配置运行时。请前往首页安装或修复。
              </div>
            )}
            {/* Active sessions warning */}
            {hasOngoingSessions && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-400">
                <Info className="size-4 shrink-0" />
                正在运行的会话需要重启后才会应用扩展变更。
              </div>
            )}
            <Tabs
              value={tabState.activeSubTab}
              onValueChange={(v) =>
                tabState.setActiveSubTab(v as 'plugins' | 'mcp-servers' | 'skills' | 'api-keys')
              }
            >
              <div className="-mx-6 flex items-end justify-between border-b border-border px-6">
                <TabsList className="gap-1 rounded-b-none">
                  {subTabs.map((subTab) => (
                    <ExtensionsSubTabTrigger
                      key={subTab.value}
                      value={subTab.value}
                      label={subTab.label}
                      icon={subTab.icon}
                      description={subTab.description}
                    />
                  ))}
                </TabsList>
                {tabState.activeSubTab === 'mcp-servers' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={mcpMutationDisableReason ? 0 : -1}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCustomMcpDialogOpen(true)}
                          className="mb-1 whitespace-nowrap"
                          disabled={Boolean(mcpMutationDisableReason)}
                        >
                          <Plus className="mr-1 size-3.5" />
                          Add Custom
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {mcpMutationDisableReason && (
                      <TooltipContent>{mcpMutationDisableReason}</TooltipContent>
                    )}
                  </Tooltip>
                )}
              </div>

              <TabsContent value="plugins" className="mt-0 pt-4">
                <PluginsPanel
                  projectPath={projectPath}
                  pluginFilters={tabState.pluginFilters}
                  pluginSort={tabState.pluginSort}
                  selectedPluginId={tabState.selectedPluginId}
                  updatePluginSearch={tabState.updatePluginSearch}
                  toggleCategory={tabState.toggleCategory}
                  toggleCapability={tabState.toggleCapability}
                  toggleInstalledOnly={tabState.toggleInstalledOnly}
                  setSelectedPluginId={tabState.setSelectedPluginId}
                  clearFilters={tabState.clearFilters}
                  hasActiveFilters={tabState.hasActiveFilters}
                  setPluginSort={tabState.setPluginSort}
                  cliStatus={effectiveCliStatus}
                  cliStatusLoading={effectiveCliStatusLoading}
                />
              </TabsContent>

              <TabsContent value="mcp-servers" className="mt-0 pt-4">
                <McpServersPanel
                  projectPath={projectPath}
                  mcpSearchQuery={tabState.mcpSearchQuery}
                  mcpSearch={tabState.mcpSearch}
                  mcpSearchResults={tabState.mcpSearchResults}
                  mcpSearchLoading={tabState.mcpSearchLoading}
                  mcpSearchWarnings={tabState.mcpSearchWarnings}
                  selectedMcpServerId={tabState.selectedMcpServerId}
                  setSelectedMcpServerId={tabState.setSelectedMcpServerId}
                  cliStatus={effectiveCliStatus}
                  cliStatusLoading={effectiveCliStatusLoading}
                />
              </TabsContent>

              <TabsContent value="api-keys" className="mt-0 pt-4">
                <ApiKeysPanel projectPath={projectPath} projectLabel={projectLabel} />
              </TabsContent>

              <TabsContent value="skills" className="mt-0 pt-4">
                <SkillsPanel
                  projectPath={projectPath}
                  projectLabel={projectLabel}
                  skillsSearchQuery={tabState.skillsSearchQuery}
                  setSkillsSearchQuery={tabState.setSkillsSearchQuery}
                  skillsSort={tabState.skillsSort}
                  setSkillsSort={tabState.setSkillsSort}
                  selectedSkillId={tabState.selectedSkillId}
                  setSelectedSkillId={tabState.setSelectedSkillId}
                />
              </TabsContent>
            </Tabs>

            {/* Custom MCP server dialog (lifted to store view level) */}
            <CustomMcpServerDialog
              open={customMcpDialogOpen}
              onClose={() => setCustomMcpDialogOpen(false)}
              projectPath={projectPath}
              cliStatus={effectiveCliStatus}
              cliStatusLoading={effectiveCliStatusLoading}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};
