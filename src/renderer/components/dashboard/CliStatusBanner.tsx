/**
 * CliStatusBanner — CLI installation status banner for the Dashboard.
 *
 * Shown on the main screen before project search.
 * Displays CLI version/path when installed, or a red error with install button when not.
 * Shows live detail text for every phase and a mini log panel during installation.
 * Only rendered in Electron mode.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  formatCodexRemainingPercent,
  formatCodexWindowDuration,
  mergeCodexProviderStatusWithSnapshot,
  normalizeCodexResetTimestamp,
  useCodexAccountSnapshot,
} from '@features/codex-account/renderer';
import { api, isElectronMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
import {
  formatProviderStatusText,
  getProviderConnectionModeSummary,
  getProviderConnectLabel,
  getProviderCredentialSummary,
  getProviderCurrentRuntimeSummary,
  getProviderDisconnectAction,
  isConnectionManagedRuntimeProvider,
  shouldShowProviderConnectAction,
} from '@renderer/components/runtime/providerConnectionUi';
import { ProviderModelBadges } from '@renderer/components/runtime/ProviderModelBadges';
import { getProviderRuntimeBackendSummary } from '@renderer/components/runtime/ProviderRuntimeBackendSelector';
import { ProviderRuntimeSettingsDialog } from '@renderer/components/runtime/ProviderRuntimeSettingsDialog';
import { TerminalLogPanel } from '@renderer/components/terminal/TerminalLogPanel';
import { TerminalModal } from '@renderer/components/terminal/TerminalModal';
import { useCliInstaller } from '@renderer/hooks/useCliInstaller';
import {
  loadDashboardCliStatusBannerCollapsed,
  saveDashboardCliStatusBannerCollapsed,
} from '@renderer/services/dashboardCliStatusBannerPreference';
import { useStore } from '@renderer/store';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import { formatBytes } from '@renderer/utils/formatters';
import { filterMainScreenCliProviders } from '@renderer/utils/geminiUiFreeze';
import { isMultimodelRuntimeStatus } from '@renderer/utils/multimodelProviderVisibility';
import { resolveProjectPathById } from '@renderer/utils/projectLookup';
import { refreshCliStatusForCurrentMode } from '@renderer/utils/refreshCliStatus';
import { getRuntimeDisplayName as getHumanRuntimeDisplayName } from '@renderer/utils/runtimeDisplayName';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  HelpCircle,
  Loader2,
  LogIn,
  LogOut,
  Puzzle,
  RefreshCw,
  SlidersHorizontal,
  Terminal,
} from 'lucide-react';

import type { CliProviderId, CliProviderStatus } from '@shared/types';

// =============================================================================
// Border color by state
// =============================================================================

type BannerVariant = 'loading' | 'error' | 'success' | 'info' | 'warning';

const VARIANT_STYLES: Record<BannerVariant, { border: string; bg: string }> = {
  loading: { border: 'var(--color-border)', bg: 'transparent' },
  error: { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.06)' },
  success: { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.04)' },
  info: { border: 'var(--info-border)', bg: 'var(--info-bg)' },
  warning: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.06)' },
};

const OPENCODE_DOWNLOAD_URL = 'https://opencode.ai/download';

/** Minimum banner height — prevents layout shift between states (loading → installed → checking). */
const BANNER_MIN_H = 'min-h-[4.25rem]';

interface CodexDashboardRateLimitItem {
  label: string;
  remaining: string;
  resetsAt: string;
}

function getCodexDashboardHint(provider: CliProviderStatus): string | null {
  if (provider.providerId !== 'codex') {
    return null;
  }

  const codex = provider.connection?.codex;
  if (!codex || codex.managedAccount?.type === 'chatgpt') {
    return null;
  }

  if (codex.login.status === 'starting' || codex.login.status === 'pending') {
    return null;
  }

  const usageHint = codex.localActiveChatgptAccountPresent
    ? 'Codex 刷新当前选中的 ChatGPT 会话后才会显示用量限制。当前本地会话需要重新连接。'
    : codex.localAccountArtifactsPresent
      ? 'Codex CLI 检测到活跃 ChatGPT 账号后才会显示用量限制。本地已有 Codex 账号数据，但当前没有选中活跃托管会话。'
      : 'Codex CLI 检测到活跃 ChatGPT 账号后才会显示用量限制。当前未检测到活跃 ChatGPT 登录。';
  if (
    provider.connection?.configuredAuthMode === 'chatgpt' &&
    provider.connection.apiKeyConfigured
  ) {
    return `${usageHint} 切换认证模式后可以使用 API Key 兜底。`;
  }

  if (provider.connection?.configuredAuthMode === 'auto' && provider.connection.apiKeyConfigured) {
    return `${usageHint} 自动模式会在 ChatGPT 连接前继续使用 API Key。`;
  }

  return provider.connection?.configuredAuthMode === 'chatgpt' ? usageHint : null;
}

// =============================================================================
// Sub-components
// =============================================================================

/** Detail text shown under the main status line */
const DetailLine = ({ text }: { text: string | null }): React.JSX.Element | null => {
  if (!text) return null;
  return (
    <p className="mt-1 truncate font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
      {text}
    </p>
  );
};

const InstallCompletedNotice = ({
  version,
  runtimeDisplayName,
}: {
  version: string | null;
  runtimeDisplayName: string;
}): React.JSX.Element => (
  <div
    className={`mb-6 flex items-center gap-3 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
    style={{
      borderColor: VARIANT_STYLES.success.border,
      backgroundColor: VARIANT_STYLES.success.bg,
    }}
  >
    <CheckCircle className="size-4 shrink-0" style={{ color: '#4ade80' }} />
    <span className="text-sm" style={{ color: '#4ade80' }}>
      已成功安装 {runtimeDisplayName} v{version ?? 'latest'}
    </span>
  </div>
);

/** Error display with multi-line support */
const ErrorDisplay = ({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}): React.JSX.Element => {
  const lines = error.split('\n');
  const title = lines[0];
  const details = lines.slice(1).filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: '#f87171' }} />
          <div className="min-w-0">
            <p className="text-sm font-medium" style={{ color: '#f87171' }}>
              {title}
            </p>
            {details.length > 0 && (
              <div
                className="mt-1.5 rounded border px-2 py-1.5 font-mono text-xs leading-relaxed"
                style={{
                  borderColor: 'rgba(239, 68, 68, 0.2)',
                  backgroundColor: 'rgba(239, 68, 68, 0.04)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {details.map((line, i) => (
                  <div key={i} className="break-all">
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <RefreshCw className="size-3.5" />
          重试
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// CLI checking spinner with delayed hint
// =============================================================================

const SLOW_CHECK_DELAY_MS = 5_000;

const CliCheckingSpinner = ({
  styles,
  label,
}: {
  styles: { border: string; bg: string };
  label: string;
}): React.JSX.Element => {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), SLOW_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`mb-6 flex items-center gap-3 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
      style={{ borderColor: styles.border, backgroundColor: styles.bg }}
    >
      <Loader2
        className="size-4 shrink-0 animate-spin"
        style={{ color: 'var(--color-text-muted)' }}
      />
      <div>
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        {showHint && (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
            首次检查可能需要最多 30 秒
          </p>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Installed banner (extracted sub-component)
// =============================================================================

interface InstalledBannerProps {
  cliStatus: NonNullable<ReturnType<typeof useCliInstaller>['cliStatus']>;
  sourceProviderMap: Map<CliProviderId, CliProviderStatus>;
  cliStatusLoading: boolean;
  cliProviderStatusLoading: Partial<Record<CliProviderId, boolean>>;
  codexSnapshotPending: boolean;
  cliStatusError: string | null;
  providersCollapsed: boolean;
  isBusy: boolean;
  onInstall: () => void;
  onRefresh: () => void;
  onToggleProvidersCollapsed: () => void;
  onProviderLogin: (providerId: CliProviderId) => void;
  onProviderLogout: (providerId: CliProviderId) => void;
  onProviderManage: (providerId: CliProviderId) => void;
  onProviderRefresh: (providerId: CliProviderId) => void;
  onCodexReconnect: () => void;
  codexReconnectBusy: boolean;
  variant: BannerVariant;
}

function getProviderLabel(providerId: CliProviderId): string {
  switch (providerId) {
    case 'anthropic':
      return 'Anthropic';
    case 'codex':
      return 'Codex';
    case 'gemini':
      return 'Gemini';
    case 'opencode':
      return 'OpenCode (75+ LLM providers)';
  }
}

function getProviderTerminalCommand(provider: CliProviderStatus): {
  args: string[];
  env?: Record<string, string>;
} {
  if (provider.providerId === 'gemini') {
    return {
      args: ['login'],
      env: {
        CLAUDE_CODE_ENTRY_PROVIDER: 'gemini',
        CLAUDE_CODE_GEMINI_BACKEND: provider.selectedBackendId ?? 'auto',
      },
    };
  }

  if (provider.providerId === 'codex') {
    return {
      args: ['auth', 'login', '--provider', provider.providerId],
      env: {
        CLAUDE_CODE_CODEX_BACKEND: provider.selectedBackendId ?? 'codex-native',
      },
    };
  }

  return {
    args: ['auth', 'login', '--provider', provider.providerId],
  };
}

function getProviderTerminalLogoutCommand(provider: CliProviderStatus): {
  args: string[];
  env?: Record<string, string>;
} {
  if (provider.providerId === 'gemini') {
    return {
      args: ['logout'],
      env: {
        CLAUDE_CODE_ENTRY_PROVIDER: 'gemini',
        CLAUDE_CODE_GEMINI_BACKEND: provider.selectedBackendId ?? 'auto',
      },
    };
  }

  if (provider.providerId === 'codex') {
    return {
      args: ['auth', 'logout', '--provider', provider.providerId],
      env: {
        CLAUDE_CODE_CODEX_BACKEND: provider.selectedBackendId ?? 'codex-native',
      },
    };
  }

  return {
    args: ['auth', 'logout', '--provider', provider.providerId],
  };
}

const ProviderDetailSkeleton = (): React.JSX.Element => {
  return (
    <div className="mt-1 space-y-2">
      <div
        className="skeleton-shimmer h-3 rounded-sm"
        style={{ width: '58%', backgroundColor: 'var(--skeleton-base)' }}
      />
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="skeleton-shimmer h-6 rounded-md border"
            style={{
              width: index === 0 ? 56 : index === 1 ? 84 : index === 2 ? 72 : 96,
              borderColor: 'var(--color-border-subtle)',
              backgroundColor: 'var(--skeleton-base-dim)',
            }}
          />
        ))}
      </div>
    </div>
  );
};

const OpenCodeBetaBadge = (): React.JSX.Element => {
  return (
    <span
      className="inline-flex h-4 shrink-0 items-center rounded border px-1.5 text-[9px] font-semibold uppercase leading-none"
      style={{
        borderColor: 'rgba(251, 191, 36, 0.32)',
        backgroundColor: 'rgba(251, 191, 36, 0.12)',
        color: '#fbbf24',
      }}
    >
      beta
    </span>
  );
};

function isProviderCardLoading(provider: CliProviderStatus, providerLoading: boolean): boolean {
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

function shouldMaskCodexNegativeBootstrapState(
  sourceProvider: CliProviderStatus | null,
  mergedProvider: CliProviderStatus
): boolean {
  return (
    sourceProvider?.providerId === 'codex' &&
    sourceProvider.statusMessage === 'Checking...' &&
    mergedProvider.providerId === 'codex' &&
    mergedProvider.connection?.codex?.launchReadinessState === 'missing_auth' &&
    mergedProvider.connection.codex.login.status === 'idle'
  );
}

function getProviderStatusColor(statusText: string, authenticated: boolean): string {
  if (statusText === 'Checking...' || statusText === '正在检查...') {
    return 'var(--color-text-secondary)';
  }

  return authenticated ? '#4ade80' : 'var(--color-text-muted)';
}

function getApiKeyActionRequiredProviders(
  providers: readonly CliProviderStatus[]
): CliProviderStatus[] {
  return providers.filter(
    (provider) => !provider.authenticated && provider.connection?.configuredAuthMode === 'api_key'
  );
}

function formatRuntimeLabel(
  cliStatus: NonNullable<ReturnType<typeof useCliInstaller>['cliStatus']>
): string | null {
  if (cliStatus.flavor === 'agent_teams_orchestrator') {
    return null;
  }

  const runtimeLabel = getHumanRuntimeDisplayName(cliStatus);
  return cliStatus.showVersionDetails && cliStatus.installedVersion
    ? `${runtimeLabel} v${cliStatus.installedVersion ?? 'unknown'}`
    : runtimeLabel;
}

function isCodexSubscriptionActive(
  connection: CliProviderStatus['connection'] | null | undefined
): boolean {
  return (
    connection?.codex?.effectiveAuthMode === 'chatgpt' &&
    (connection.codex.managedAccount?.type === 'chatgpt' || connection.codex.launchAllowed)
  );
}

function buildCodexRateLimitLabel(
  fallbackTitle: 'Primary left' | 'Secondary left' | 'Weekly left',
  windowDurationMins: number | null | undefined
): string {
  const duration = formatCodexWindowDuration(windowDurationMins);
  if (duration) {
    return `剩余 ${duration}`;
  }
  switch (fallbackTitle) {
    case 'Primary left':
      return '主要额度剩余';
    case 'Secondary left':
      return '次要额度剩余';
    case 'Weekly left':
      return '每周额度剩余';
  }
}

function formatCodexDashboardResetTime(timestampSeconds: number | null | undefined): string {
  const normalized = normalizeCodexResetTimestamp(timestampSeconds);
  if (!normalized) {
    return '重置时间未知';
  }

  return new Date(normalized).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getCodexDashboardRateLimits(
  provider: CliProviderStatus
): CodexDashboardRateLimitItem[] | null {
  if (provider.providerId !== 'codex' || !isCodexSubscriptionActive(provider.connection)) {
    return null;
  }

  const rateLimits = provider.connection?.codex?.rateLimits;
  if (!rateLimits?.primary) {
    return null;
  }

  const items: CodexDashboardRateLimitItem[] = [];
  const primaryRemaining = formatCodexRemainingPercent(rateLimits.primary.usedPercent) ?? '未知';
  items.push({
    label: buildCodexRateLimitLabel('Primary left', rateLimits.primary.windowDurationMins),
    remaining: primaryRemaining,
    resetsAt: formatCodexDashboardResetTime(rateLimits.primary.resetsAt),
  });

  if (rateLimits.secondary) {
    items.push({
      label: buildCodexRateLimitLabel(
        rateLimits.secondary.windowDurationMins === 10_080 ? 'Weekly left' : 'Secondary left',
        rateLimits.secondary.windowDurationMins
      ),
      remaining: formatCodexRemainingPercent(rateLimits.secondary.usedPercent) ?? '未知',
      resetsAt: formatCodexDashboardResetTime(rateLimits.secondary.resetsAt),
    });
  }

  return items;
}

function formatRuntimeAuthSummary(
  cliStatus: NonNullable<ReturnType<typeof useCliInstaller>['cliStatus']>,
  visibleProviders: readonly CliProviderStatus[]
): string | null {
  if (isMultimodelRuntimeStatus(cliStatus)) {
    if (visibleProviders.length === 0) {
      return null;
    }

    if (
      visibleProviders.every(
        (provider) => provider.statusMessage === 'Checking...' && !provider.authenticated
      )
    ) {
      return '正在检查提供商...';
    }
    const denominator = visibleProviders.length;
    const connected = visibleProviders.filter((provider) => provider.authenticated).length;

    return `提供商：${connected}/${denominator} 已连接`;
  }

  if (cliStatus.authStatusChecking) {
    return '正在检查认证...';
  }

  if (cliStatus.authLoggedIn) {
    return '已认证';
  }

  return null;
}

function isCheckingMultimodelStatus(
  cliStatus: NonNullable<ReturnType<typeof useCliInstaller>['cliStatus']>,
  visibleProviders: readonly CliProviderStatus[]
): boolean {
  return (
    isMultimodelRuntimeStatus(cliStatus) &&
    visibleProviders.length > 0 &&
    visibleProviders.every(
      (provider) => provider.statusMessage === 'Checking...' && !provider.authenticated
    )
  );
}

function hasVisibleAuthenticatedMultimodelProvider(
  visibleProviders: readonly CliProviderStatus[]
): boolean {
  return visibleProviders.some((provider) => provider.authenticated);
}

function shouldShowOpenCodeDownloadAction(
  provider: CliProviderStatus,
  showSkeleton: boolean
): boolean {
  return (
    provider.providerId === 'opencode' &&
    !showSkeleton &&
    !provider.supported &&
    !provider.authenticated &&
    provider.backend == null
  );
}

const InstalledBanner = ({
  cliStatus,
  sourceProviderMap,
  cliStatusLoading,
  cliProviderStatusLoading,
  codexSnapshotPending,
  cliStatusError,
  providersCollapsed,
  isBusy,
  onInstall,
  onRefresh,
  onToggleProvidersCollapsed,
  onProviderLogin,
  onProviderLogout,
  onProviderManage,
  onProviderRefresh,
  onCodexReconnect,
  codexReconnectBusy,
  variant,
}: InstalledBannerProps): React.JSX.Element => {
  const openExtensionsTab = useStore((s) => s.openExtensionsTab);
  const styles = VARIANT_STYLES[variant];
  const visibleProviders = useMemo(
    () => filterMainScreenCliProviders(cliStatus.providers),
    [cliStatus.providers]
  );
  const canOpenExtensions = cliStatus.installed;
  const runtimeLabel = formatRuntimeLabel(cliStatus);
  const runtimeAuthSummary = formatRuntimeAuthSummary(cliStatus, visibleProviders);
  const showCollapseControl = visibleProviders.length > 0;
  const showExpandedContent = !providersCollapsed;

  return (
    <div
      className={`mb-6 rounded-lg border-l-4 px-4 ${
        showExpandedContent ? `py-3 ${BANNER_MIN_H}` : 'py-2.5'
      }`}
      style={{ borderColor: styles.border, backgroundColor: styles.bg }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showCollapseControl && (
            <button
              type="button"
              onClick={onToggleProvidersCollapsed}
              className="flex items-center justify-center rounded-md p-1 transition-colors hover:bg-white/5"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label={providersCollapsed ? '展开提供商详情' : '折叠提供商详情'}
              aria-expanded={!providersCollapsed}
              title={providersCollapsed ? '展开提供商详情' : '折叠提供商详情'}
            >
              {providersCollapsed ? (
                <ChevronRight className="size-4 shrink-0" />
              ) : (
                <ChevronDown className="size-4 shrink-0" />
              )}
            </button>
          )}
          <Terminal className="size-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {runtimeLabel && (
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {runtimeLabel}
                </span>
              )}

              {/* Update / Check for Updates — inline next to version */}
              {cliStatus.supportsSelfUpdate && cliStatus.updateAvailable ? (
                <button
                  onClick={onInstall}
                  disabled={isBusy}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#3b82f6' }}
                >
                  <Download className="size-3" />
                  更新到 v{cliStatus.latestVersion}
                </button>
              ) : cliStatus.supportsSelfUpdate ? (
                <button
                  onClick={onRefresh}
                  disabled={cliStatusLoading}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <RefreshCw className={cliStatusLoading ? 'size-3 animate-spin' : 'size-3'} />
                  {cliStatusLoading ? '正在检查...' : '检查更新'}
                </button>
              ) : null}

              {runtimeAuthSummary && (
                <span className="text-xs" style={{ color: '#4ade80' }}>
                  {runtimeAuthSummary}
                </span>
              )}
            </div>
            {cliStatus.showBinaryPath && cliStatus.binaryPath && (
              <button
                className="truncate font-mono text-xs hover:underline"
                style={{ color: 'var(--color-text-muted)' }}
                title={`在文件管理器中显示：${cliStatus.binaryPath}`}
                onClick={() => void api.showInFolder(cliStatus.binaryPath!)}
              >
                {cliStatus.binaryPath}
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-8">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              多模型
            </span>
          </div>
          {/* Extensions button — available whenever the runtime is installed */}
          {canOpenExtensions && (
            <button
              onClick={openExtensionsTab}
              className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              <Puzzle className="size-3.5" />
              扩展
            </button>
          )}
        </div>
      </div>
      {showExpandedContent && cliStatusError && !cliStatusLoading && (
        <p className="mt-2 text-xs" style={{ color: '#f87171' }}>
          检查更新失败。请检查网络连接后重试。
        </p>
      )}
      {showExpandedContent && visibleProviders.length > 0 && (
        <div
          className="mt-3 space-y-2 border-t pt-3"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          {visibleProviders.map((provider) => {
            const actionDisabled = isBusy || !cliStatus.binaryPath;
            const runtimeSummary = isConnectionManagedRuntimeProvider(provider)
              ? getProviderCurrentRuntimeSummary(provider)
              : getProviderRuntimeBackendSummary(provider);
            const connectionModeSummary = getProviderConnectionModeSummary(provider);
            const credentialSummary = getProviderCredentialSummary(provider);
            const codexDashboardRateLimits = getCodexDashboardRateLimits(provider);
            const codexDashboardHint = getCodexDashboardHint(provider);
            const codexNeedsReconnect =
              provider.providerId === 'codex' &&
              Boolean(provider.connection?.codex?.localActiveChatgptAccountPresent) &&
              provider.connection?.codex?.launchAllowed !== true &&
              provider.connection?.codex?.login.status !== 'starting' &&
              provider.connection?.codex?.login.status !== 'pending';
            const disconnectAction = getProviderDisconnectAction(provider);
            const providerLoading = cliProviderStatusLoading[provider.providerId] === true;
            const sourceProvider = sourceProviderMap.get(provider.providerId) ?? null;
            const maskNegativeBootstrapState = shouldMaskCodexNegativeBootstrapState(
              sourceProvider,
              provider
            );
            const showSkeleton =
              isProviderCardLoading(provider, providerLoading) ||
              isCodexSnapshotPending(provider, codexSnapshotPending) ||
              maskNegativeBootstrapState;
            const showInlineCodexAccessoryRow =
              !showSkeleton &&
              provider.providerId === 'codex' &&
              provider.models.length > 0 &&
              Boolean(codexDashboardRateLimits?.length);
            const statusText = showSkeleton ? '正在检查...' : formatProviderStatusText(provider);
            const hasDetailContent = Boolean(
              (provider.backend?.label && !runtimeSummary) ||
              runtimeSummary ||
              connectionModeSummary ||
              credentialSummary ||
              provider.models.length === 0
            );

            return (
              <div
                key={provider.providerId}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-md p-2"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}
              >
                <div className="col-span-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-2">
                        <ProviderBrandLogo
                          providerId={provider.providerId}
                          className="size-4 shrink-0"
                        />
                        <span
                          className="text-xs font-medium"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {provider.providerId === 'opencode'
                            ? getProviderLabel(provider.providerId)
                            : provider.displayName}
                        </span>
                        {provider.providerId === 'opencode' ? <OpenCodeBetaBadge /> : null}
                      </span>
                      <span
                        className="text-xs"
                        style={{
                          color: getProviderStatusColor(statusText, provider.authenticated),
                        }}
                      >
                        {statusText}
                      </span>
                    </div>
                    {showSkeleton ? (
                      <ProviderDetailSkeleton />
                    ) : hasDetailContent ? (
                      <div
                        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {provider.backend?.label && !runtimeSummary && (
                          <span>后端：{provider.backend.label}</span>
                        )}
                        {runtimeSummary ? (
                          <span>
                            {isConnectionManagedRuntimeProvider(provider)
                              ? runtimeSummary
                              : `运行时：${runtimeSummary}`}
                          </span>
                        ) : null}
                        {connectionModeSummary ? <span>{connectionModeSummary}</span> : null}
                        {credentialSummary ? <span>{credentialSummary}</span> : null}
                        {provider.models.length === 0 && <span>当前运行时版本无法获取模型</span>}
                      </div>
                    ) : null}
                    {showInlineCodexAccessoryRow ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ProviderModelBadges
                          providerId={provider.providerId}
                          models={provider.models}
                          modelAvailability={provider.modelAvailability}
                          providerStatus={provider}
                          collapseAfter={15}
                        />
                        {codexDashboardRateLimits!.map((item) => (
                          <div
                            key={`${provider.providerId}-${item.label}`}
                            className="rounded-md border px-2 py-1.5"
                            style={{
                              borderColor: 'rgba(74, 222, 128, 0.2)',
                              backgroundColor: 'rgba(74, 222, 128, 0.06)',
                            }}
                          >
                            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                              <span
                                className="text-[10px] uppercase tracking-[0.06em]"
                                style={{ color: 'var(--color-text-muted)' }}
                              >
                                {item.label}
                              </span>
                              <span className="text-xs font-medium" style={{ color: '#86efac' }}>
                                {item.remaining}
                              </span>
                              <span
                                className="min-w-0 truncate text-[10px]"
                                style={{ color: 'var(--color-text-secondary)' }}
                                title={item.resetsAt}
                              >
                                • 重置于 {item.resetsAt}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : !showSkeleton &&
                      codexDashboardRateLimits &&
                      codexDashboardRateLimits.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {codexDashboardRateLimits.map((item) => (
                          <div
                            key={`${provider.providerId}-${item.label}`}
                            className="rounded-md border px-2 py-1.5"
                            style={{
                              borderColor: 'rgba(74, 222, 128, 0.2)',
                              backgroundColor: 'rgba(74, 222, 128, 0.06)',
                            }}
                          >
                            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                              <span
                                className="text-[10px] uppercase tracking-[0.06em]"
                                style={{ color: 'var(--color-text-muted)' }}
                              >
                                {item.label}
                              </span>
                              <span className="text-xs font-medium" style={{ color: '#86efac' }}>
                                {item.remaining}
                              </span>
                              <span
                                className="min-w-0 truncate text-[10px]"
                                style={{ color: 'var(--color-text-secondary)' }}
                                title={item.resetsAt}
                              >
                                • 重置于 {item.resetsAt}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : !showSkeleton && codexDashboardHint ? (
                      <div
                        className="mt-2 rounded-md border px-2.5 py-2 text-[11px]"
                        style={{
                          borderColor: 'rgba(255, 255, 255, 0.08)',
                          backgroundColor: 'rgba(255, 255, 255, 0.025)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1">{codexDashboardHint}</span>
                          {codexNeedsReconnect ? (
                            <button
                              type="button"
                              onClick={onCodexReconnect}
                              disabled={codexReconnectBusy || actionDisabled}
                              className="shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
                              style={{
                                borderColor: 'rgba(245, 158, 11, 0.28)',
                                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                                color: '#fbbf24',
                              }}
                            >
                              重新连接 ChatGPT
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    {shouldShowOpenCodeDownloadAction(provider, showSkeleton) ? (
                      <button
                        type="button"
                        onClick={() => void api.openExternal(OPENCODE_DOWNLOAD_URL)}
                        className="flex items-center gap-1 rounded-md border px-2 py-[3px] text-[10px] font-medium transition-colors hover:bg-white/5"
                        style={{
                          borderColor: 'rgba(14, 165, 233, 0.36)',
                          color: '#7dd3fc',
                        }}
                        title="下载 OpenCode CLI"
                      >
                        <Download className="size-3" />
                        下载
                      </button>
                    ) : null}
                    <button
                      onClick={() => onProviderManage(provider.providerId)}
                      disabled={actionDisabled}
                      className="flex items-center gap-1 rounded-md border px-2 py-[3px] text-[10px] font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
                      style={{
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      <SlidersHorizontal className="size-3" />
                      管理
                    </button>
                    {disconnectAction ? (
                      <button
                        onClick={() => onProviderLogout(provider.providerId)}
                        disabled={actionDisabled}
                        className="flex items-center gap-1 rounded-md border px-2 py-[3px] text-[10px] font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        <LogOut className="size-3" />
                        {disconnectAction.label}
                      </button>
                    ) : !showSkeleton && shouldShowProviderConnectAction(provider) ? (
                      <button
                        onClick={() => onProviderLogin(provider.providerId)}
                        disabled={actionDisabled}
                        className="flex items-center gap-1 rounded-md border px-2 py-[3px] text-[10px] font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        <LogIn className="size-3" />
                        {getProviderConnectLabel(provider)}
                      </button>
                    ) : null}
                    <button
                      onClick={() => onProviderRefresh(provider.providerId)}
                      disabled={providerLoading}
                      className="flex items-center gap-1 rounded-md border px-1.5 py-[3px] text-[10px] transition-colors hover:bg-white/5 disabled:opacity-50"
                      style={{
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-secondary)',
                      }}
                      title={`重新检查 ${provider.displayName}`}
                    >
                      <RefreshCw
                        className={providerLoading ? 'size-[11px] animate-spin' : 'size-[11px]'}
                      />
                    </button>
                  </div>
                </div>
                {!showSkeleton && provider.models.length > 0 && !showInlineCodexAccessoryRow && (
                  <div className="col-span-2">
                    <ProviderModelBadges
                      providerId={provider.providerId}
                      models={provider.models}
                      modelAvailability={provider.modelAvailability}
                      providerStatus={provider}
                      collapseAfter={15}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const CliStatusBanner = (): React.JSX.Element | null => {
  const isElectron = useMemo(() => isElectronMode(), []);
  const appConfig = useStore((s) => s.appConfig);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const projects = useStore((s) => s.projects);
  const repositoryGroups = useStore((s) => s.repositoryGroups);
  const updateConfig = useStore((s) => s.updateConfig);
  const {
    cliStatus,
    cliStatusLoading,
    cliProviderStatusLoading,
    cliStatusError,
    installerState,
    downloadProgress,
    downloadTransferred,
    downloadTotal,
    installerError,
    installerDetail,
    installerRawChunks,
    completedVersion,
    bootstrapCliStatus,
    fetchCliStatus,
    fetchCliProviderStatus,
    invalidateCliStatus,
    installCli,
    isBusy,
  } = useCliInstaller();

  const [showLoginTerminal, setShowLoginTerminal] = useState(false);
  const [providerTerminal, setProviderTerminal] = useState<{
    providerId: CliProviderId;
    action: 'login' | 'logout';
  } | null>(null);
  const [manageProviderId, setManageProviderId] = useState<CliProviderId>('anthropic');
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [isVerifyingAuth, setIsVerifyingAuth] = useState(false);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [providersCollapsed, setProvidersCollapsed] = useState(() =>
    loadDashboardCliStatusBannerCollapsed()
  );
  const multimodelEnabled = appConfig?.general?.multimodelEnabled ?? true;
  const selectedProjectPath = useMemo(
    () => resolveProjectPathById(selectedProjectId, projects, repositoryGroups)?.path ?? null,
    [projects, repositoryGroups, selectedProjectId]
  );
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
      Boolean(loadingCliStatus?.providers.some((provider) => provider.providerId === 'codex')),
    includeRateLimits: true,
  });
  const visibleCliProviders = useMemo(
    () =>
      filterMainScreenCliProviders(loadingCliStatus?.providers ?? []).map((provider) =>
        provider.providerId === 'codex'
          ? mergeCodexProviderStatusWithSnapshot(provider, codexAccount.snapshot)
          : provider
      ),
    [loadingCliStatus?.providers, codexAccount.snapshot]
  );
  const loadingCliProviderMap = useMemo(
    () =>
      new Map(
        filterMainScreenCliProviders(loadingCliStatus?.providers ?? []).map((provider) => [
          provider.providerId,
          provider,
        ])
      ),
    [loadingCliStatus?.providers]
  );
  const codexSnapshotPending =
    codexAccount.loading &&
    Boolean(loadingCliStatus?.providers.some((provider) => provider.providerId === 'codex')) &&
    !codexAccount.snapshot;
  const effectiveCliStatus = useMemo(
    () =>
      loadingCliStatus
        ? {
            ...loadingCliStatus,
            providers: visibleCliProviders,
          }
        : loadingCliStatus,
    [loadingCliStatus, visibleCliProviders]
  );
  const renderCliStatus = effectiveCliStatus;
  const runtimeDisplayName = getHumanRuntimeDisplayName(renderCliStatus, multimodelEnabled);

  useEffect(() => {
    if (!isElectron) return;
    // IMPORTANT: do NOT auto-fetch on mount.
    // Store initialization already schedules a deferred CLI status check to avoid
    // competing with initial teams/tasks/project scans.
    // Keep a low-frequency refresh, but only after we've successfully loaded a status.
    if (!cliStatus) {
      return;
    }

    const interval = setInterval(
      () => {
        void refreshCliStatusForCurrentMode({
          multimodelEnabled,
          bootstrapCliStatus,
          fetchCliStatus,
        });
      },
      10 * 60 * 1000
    );

    return () => clearInterval(interval);
  }, [bootstrapCliStatus, cliStatus, fetchCliStatus, isElectron, multimodelEnabled]);

  const handleInstall = useCallback(() => {
    installCli();
  }, [installCli]);

  const handleRefresh = useCallback(() => {
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
  }, [bootstrapCliStatus, fetchCliStatus, multimodelEnabled]);

  const handleToggleProvidersCollapsed = useCallback(() => {
    setProvidersCollapsed((current) => {
      const next = !current;
      saveDashboardCliStatusBannerCollapsed(next);
      return next;
    });
  }, []);

  const handleCodexDashboardLogin = useCallback(() => {
    void (async () => {
      const success = await codexAccount.startChatgptLogin();
      if (success) {
        await refreshCliStatusForCurrentMode({
          multimodelEnabled,
          bootstrapCliStatus,
          fetchCliStatus,
        });
      }
    })();
  }, [bootstrapCliStatus, codexAccount, fetchCliStatus, multimodelEnabled]);

  const recheckAuthState = useCallback(() => {
    setIsVerifyingAuth(true);
    void (async () => {
      try {
        await invalidateCliStatus();
        await refreshCliStatusForCurrentMode({
          multimodelEnabled,
          bootstrapCliStatus,
          fetchCliStatus,
        });
      } finally {
        setIsVerifyingAuth(false);
      }
    })();
  }, [bootstrapCliStatus, fetchCliStatus, invalidateCliStatus, multimodelEnabled]);

  const handleProviderLogin = useCallback((providerId: CliProviderId) => {
    setProviderTerminal({ providerId, action: 'login' });
  }, []);

  const handleProviderLogout = useCallback(
    (providerId: CliProviderId) => {
      void (async () => {
        const provider =
          effectiveCliStatus?.providers.find((entry) => entry.providerId === providerId) ?? null;
        const disconnectAction = provider ? getProviderDisconnectAction(provider) : null;
        if (!disconnectAction) {
          return;
        }

        const confirmed = await confirm({
          title: disconnectAction.title,
          message: disconnectAction.message,
          confirmLabel: disconnectAction.confirmLabel,
          cancelLabel: '取消',
          variant: 'danger',
        });

        if (!confirmed) {
          return;
        }

        setProviderTerminal({ providerId, action: 'logout' });
      })();
    },
    [effectiveCliStatus?.providers]
  );

  const handleProviderManage = useCallback((providerId: CliProviderId) => {
    setManageProviderId(providerId);
    setManageDialogOpen(true);
  }, []);

  const handleProviderRefresh = useCallback(
    (providerId: CliProviderId) => {
      void fetchCliProviderStatus(providerId);
    },
    [fetchCliProviderStatus]
  );

  const handleProviderBackendChange = useCallback(
    async (providerId: CliProviderId, backendId: string) => {
      if (providerId !== 'gemini' && providerId !== 'codex') {
        return;
      }

      const currentBackends = appConfig?.runtime?.providerBackends ?? {
        gemini: 'auto' as const,
        codex: 'codex-native' as const,
      };

      await updateConfig('runtime', {
        providerBackends: {
          ...currentBackends,
          [providerId]: backendId,
        },
      });

      try {
        await fetchCliProviderStatus(providerId);
      } catch {
        throw new Error('运行时已更新，但刷新提供商状态失败。');
      }
    },
    [appConfig?.runtime?.providerBackends, fetchCliProviderStatus, updateConfig]
  );

  if (!isElectron) return null;

  // Determine variant for styling
  const getVariant = (): BannerVariant => {
    if (installerState === 'error') return 'error';
    if (installerState === 'completed') return 'success';
    if (installerState !== 'idle') return 'info';
    if (!renderCliStatus) return 'loading';
    if (isCheckingMultimodelStatus(renderCliStatus, visibleCliProviders)) return 'info';
    if (renderCliStatus.authStatusChecking) return 'info';
    if (!renderCliStatus.installed) return 'error';
    if (isMultimodelRuntimeStatus(renderCliStatus) && visibleCliProviders.length === 0) {
      return 'warning';
    }
    if (
      isMultimodelRuntimeStatus(renderCliStatus) &&
      visibleCliProviders.length > 0 &&
      !hasVisibleAuthenticatedMultimodelProvider(visibleCliProviders)
    ) {
      return 'warning';
    }
    if (renderCliStatus.installed && !renderCliStatus.authLoggedIn) return 'warning';
    if (renderCliStatus.updateAvailable) return 'info';
    return 'success';
  };

  const variant = getVariant();
  const styles = VARIANT_STYLES[variant];
  const activeTerminalProvider = providerTerminal
    ? (effectiveCliStatus?.providers.find(
        (provider) => provider.providerId === providerTerminal.providerId
      ) ?? null)
    : null;
  const providerTerminalCommand =
    providerTerminal && activeTerminalProvider
      ? providerTerminal.action === 'login'
        ? getProviderTerminalCommand(activeTerminalProvider)
        : getProviderTerminalLogoutCommand(activeTerminalProvider)
      : null;
  const installedAuxiliaryUi =
    renderCliStatus !== null ? (
      <>
        <ProviderRuntimeSettingsDialog
          open={manageDialogOpen}
          onOpenChange={setManageDialogOpen}
          providers={visibleCliProviders}
          projectPath={selectedProjectPath}
          initialProviderId={
            visibleCliProviders.some((provider) => provider.providerId === manageProviderId)
              ? manageProviderId
              : (visibleCliProviders[0]?.providerId ?? 'anthropic')
          }
          providerStatusLoading={cliProviderStatusLoading}
          disabled={isBusy || cliStatusLoading || !renderCliStatus.binaryPath}
          onSelectBackend={handleProviderBackendChange}
          onRefreshProvider={(providerId) => fetchCliProviderStatus(providerId)}
          onRequestLogin={(providerId) => setProviderTerminal({ providerId, action: 'login' })}
        />
        {providerTerminal && renderCliStatus.binaryPath && (
          <TerminalModal
            title={`${getHumanRuntimeDisplayName(renderCliStatus, multimodelEnabled)} ${
              providerTerminal.action === 'login' ? '登录' : '退出登录'
            }: ${getProviderLabel(providerTerminal.providerId)}`}
            command={renderCliStatus.binaryPath}
            args={providerTerminalCommand?.args}
            env={providerTerminalCommand?.env}
            onClose={() => {
              setProviderTerminal(null);
              recheckAuthState();
            }}
            onExit={() => {
              recheckAuthState();
            }}
            autoCloseOnSuccessMs={3000}
            successMessage={providerTerminal.action === 'login' ? '认证已更新' : '提供商已退出登录'}
            failureMessage={providerTerminal.action === 'login' ? '认证失败' : '退出登录失败'}
          />
        )}
      </>
    ) : null;

  // ── Loading / fetch error state ────────────────────────────────────────
  if (!renderCliStatus && installerState === 'idle') {
    // Fetch failed — show error with retry
    if (cliStatusError && !cliStatusLoading) {
      return (
        <div
          className={`mb-6 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
          style={{
            borderColor: VARIANT_STYLES.error.border,
            backgroundColor: VARIANT_STYLES.error.bg,
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" style={{ color: '#f87171' }} />
              <span className="text-sm" style={{ color: '#f87171' }}>
                CLI 状态检查失败
              </span>
            </div>
            <button
              onClick={handleRefresh}
              className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              <RefreshCw className="size-3.5" />
              重试
            </button>
          </div>
        </div>
      );
    }

    // If we aren't currently loading, avoid showing a "stuck" spinner.
    // The initial CLI status check is deferred; allow user to trigger manually.
    if (!cliStatusLoading) {
      return (
        <div
          className={`mb-6 flex items-center justify-between gap-3 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
          style={{ borderColor: styles.border, backgroundColor: styles.bg }}
        >
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {runtimeDisplayName} 状态会在后台检查。
          </span>
          <button
            onClick={handleRefresh}
            className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            <RefreshCw className="size-3.5" />
            立即检查
          </button>
        </div>
      );
    }

    // Multimodel: render provider cards immediately instead of a generic intermediate block.
    if (multimodelEnabled) {
      return (
        <InstalledBanner
          cliStatus={renderCliStatus ?? createLoadingMultimodelCliStatus()}
          sourceProviderMap={loadingCliProviderMap}
          cliStatusLoading={cliStatusLoading}
          cliProviderStatusLoading={cliProviderStatusLoading}
          codexSnapshotPending={codexSnapshotPending}
          cliStatusError={cliStatusError ?? null}
          providersCollapsed={providersCollapsed}
          isBusy={isBusy}
          onInstall={handleInstall}
          onRefresh={handleRefresh}
          onToggleProvidersCollapsed={handleToggleProvidersCollapsed}
          onProviderLogin={handleProviderLogin}
          onProviderLogout={handleProviderLogout}
          onProviderManage={handleProviderManage}
          onProviderRefresh={handleProviderRefresh}
          onCodexReconnect={handleCodexDashboardLogin}
          codexReconnectBusy={codexAccount.loading}
          variant="info"
        />
      );
    }

    // Claude-only mode: keep the generic loading spinner.
    return (
      <CliCheckingSpinner
        styles={styles}
        label={multimodelEnabled ? '正在检查 AI 提供商...' : '正在检查 Claude CLI...'}
      />
    );
  }

  // ── Downloading ────────────────────────────────────────────────────────
  if (installerState === 'downloading') {
    return (
      <div
        className={`mb-6 space-y-2 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
        style={{ borderColor: styles.border, backgroundColor: styles.bg }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              正在下载 {runtimeDisplayName}...
            </span>
          </div>
          <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
            {downloadTotal > 0
              ? `${formatBytes(downloadTransferred)} / ${formatBytes(downloadTotal)} (${downloadProgress}%)`
              : formatBytes(downloadTransferred)}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: 'var(--color-surface-raised)' }}
        >
          {downloadTotal > 0 ? (
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress}%`, backgroundColor: '#3b82f6' }}
            />
          ) : (
            <div
              className="h-full w-1/3 animate-pulse rounded-full"
              style={{ backgroundColor: '#3b82f6' }}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Checking / Verifying ───────────────────────────────────────────────
  if (installerState === 'checking' || installerState === 'verifying') {
    const label = installerState === 'checking' ? '正在检查最新版本...' : '正在校验文件...';
    return (
      <div
        className={`mb-6 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
        style={{ borderColor: styles.border, backgroundColor: styles.bg }}
      >
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {label}
          </span>
        </div>
        <DetailLine text={installerDetail} />
      </div>
    );
  }

  // ── Installing (with log panel) ────────────────────────────────────────
  if (installerState === 'installing') {
    return (
      <div
        className={`mb-6 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
        style={{ borderColor: styles.border, backgroundColor: styles.bg }}
      >
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            正在安装 {runtimeDisplayName}...
          </span>
        </div>
        <TerminalLogPanel chunks={installerRawChunks} />
      </div>
    );
  }

  // ── Completed ──────────────────────────────────────────────────────────
  if (
    installerState === 'completed' &&
    !renderCliStatus?.installed &&
    !(renderCliStatus?.binaryPath && renderCliStatus?.launchError)
  ) {
    return (
      <InstallCompletedNotice version={completedVersion} runtimeDisplayName={runtimeDisplayName} />
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (installerState === 'error') {
    return (
      <div
        className={`mb-6 rounded-lg border-l-4 px-4 py-3 ${BANNER_MIN_H}`}
        style={{ borderColor: styles.border, backgroundColor: styles.bg }}
      >
        <ErrorDisplay error={installerError ?? '安装失败'} onRetry={handleInstall} />
      </div>
    );
  }

  // ── Idle state with status ─────────────────────────────────────────────
  if (!renderCliStatus) return null;
  const cliLaunchIssue =
    !renderCliStatus.installed &&
    Boolean(renderCliStatus.binaryPath && renderCliStatus.launchError);

  // Not installed — red error banner
  if (!renderCliStatus.installed) {
    return (
      <div
        className="mb-6 rounded-lg border-l-4 p-4"
        style={{ borderColor: styles.border, backgroundColor: styles.bg }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" style={{ color: '#ef4444' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: '#f87171' }}>
                {cliLaunchIssue
                  ? `已找到 ${runtimeDisplayName}，但启动失败`
                  : `需要安装 ${runtimeDisplayName}`}
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {cliLaunchIssue
                  ? `应用找到了已配置的 ${runtimeDisplayName}，但启动健康检查失败。请修复或重新安装后重试。`
                  : `团队启动和会话管理需要 ${runtimeDisplayName}。请先安装。`}
              </p>
              {renderCliStatus.showBinaryPath && renderCliStatus.binaryPath && (
                <p
                  className="mt-2 break-all font-mono text-[11px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {renderCliStatus.binaryPath}
                </p>
              )}
              {cliLaunchIssue && renderCliStatus.launchError && (
                <div
                  className="mt-2 rounded border px-2 py-1.5 font-mono text-[11px]"
                  style={{
                    borderColor: 'rgba(239, 68, 68, 0.2)',
                    backgroundColor: 'rgba(239, 68, 68, 0.04)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {renderCliStatus.launchError}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <button
              onClick={handleRefresh}
              className="flex items-center justify-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              <RefreshCw className="size-4" />
              重新检查
            </button>
            {renderCliStatus.supportsSelfUpdate ? (
              <button
                onClick={handleInstall}
                disabled={isBusy}
                className="flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#3b82f6' }}
              >
                <Download className="size-4" />
                {cliLaunchIssue ? `重新安装 ${runtimeDisplayName}` : `安装 ${runtimeDisplayName}`}
              </button>
            ) : (
              <p className="max-w-40 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {cliLaunchIssue
                  ? `已配置的 ${runtimeDisplayName} 未通过启动健康检查。`
                  : `未找到已配置的 ${runtimeDisplayName}。`}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Installed but not logged in — yellow warning banner
  if (
    renderCliStatus.installed &&
    renderCliStatus.flavor !== 'agent_teams_orchestrator' &&
    (renderCliStatus.authStatusChecking || isVerifyingAuth)
  ) {
    if (renderCliStatus.authStatusChecking || isVerifyingAuth) {
      return (
        <>
          <InstalledBanner
            cliStatus={renderCliStatus}
            sourceProviderMap={loadingCliProviderMap}
            cliStatusLoading={cliStatusLoading}
            cliProviderStatusLoading={cliProviderStatusLoading}
            codexSnapshotPending={codexSnapshotPending}
            cliStatusError={cliStatusError ?? null}
            providersCollapsed={providersCollapsed}
            isBusy={isBusy}
            onInstall={handleInstall}
            onRefresh={handleRefresh}
            onToggleProvidersCollapsed={handleToggleProvidersCollapsed}
            onProviderLogin={handleProviderLogin}
            onProviderLogout={handleProviderLogout}
            onProviderManage={handleProviderManage}
            onProviderRefresh={handleProviderRefresh}
            onCodexReconnect={handleCodexDashboardLogin}
            codexReconnectBusy={codexAccount.loading}
            variant={variant}
          />
          {installedAuxiliaryUi}
        </>
      );
    }
  }

  if (
    renderCliStatus.installed &&
    renderCliStatus.flavor !== 'agent_teams_orchestrator' &&
    !renderCliStatus.authStatusChecking &&
    !renderCliStatus.authLoggedIn
  ) {
    const apiKeyActionRequiredProviders = getApiKeyActionRequiredProviders(
      renderCliStatus.providers
    );
    const hasApiKeyModeIssue = apiKeyActionRequiredProviders.length > 0;
    const primaryApiKeyProvider = apiKeyActionRequiredProviders[0] ?? null;
    const apiKeyMissingProviders = apiKeyActionRequiredProviders.filter(
      (provider) => provider.connection?.apiKeyConfigured !== true
    );
    const allApiKeyIssuesAreMissingKeys =
      hasApiKeyModeIssue && apiKeyMissingProviders.length === apiKeyActionRequiredProviders.length;
    const warningTitle = hasApiKeyModeIssue
      ? allApiKeyIssuesAreMissingKeys
        ? '需要 API Key'
        : '需要处理提供商'
      : '未登录';
    const warningMessage = hasApiKeyModeIssue
      ? allApiKeyIssuesAreMissingKeys
        ? apiKeyActionRequiredProviders.length === 1 && primaryApiKeyProvider
          ? `${primaryApiKeyProvider.displayName} 已设为 API Key 模式，但尚未配置 API Key。请打开“管理提供商”添加 Key 或切换连接方式。`
          : '一个或多个提供商已设为 API Key 模式，但尚未配置 API Key。请打开“管理提供商”添加 Key 或切换连接方式。'
        : apiKeyActionRequiredProviders.length === 1 && primaryApiKeyProvider
          ? `${primaryApiKeyProvider.displayName} 已设为 API Key 模式，但当前未连接。请打开“管理提供商”检查已保存 Key 或切换连接方式。`
          : '一个或多个提供商已设为 API Key 模式，需要检查。请打开“管理提供商”检查已保存 Key 或切换连接方式。'
      : `${runtimeDisplayName} 已安装，但你尚未认证。团队启动和 AI 功能需要先登录。`;

    return (
      <>
        <InstalledBanner
          cliStatus={renderCliStatus}
          sourceProviderMap={loadingCliProviderMap}
          cliStatusLoading={cliStatusLoading}
          cliProviderStatusLoading={cliProviderStatusLoading}
          codexSnapshotPending={codexSnapshotPending}
          cliStatusError={cliStatusError ?? null}
          providersCollapsed={providersCollapsed}
          isBusy={isBusy}
          onInstall={handleInstall}
          onRefresh={handleRefresh}
          onToggleProvidersCollapsed={handleToggleProvidersCollapsed}
          onProviderLogin={handleProviderLogin}
          onProviderLogout={handleProviderLogout}
          onProviderManage={handleProviderManage}
          onProviderRefresh={handleProviderRefresh}
          onCodexReconnect={handleCodexDashboardLogin}
          codexReconnectBusy={codexAccount.loading}
          variant={variant}
        />
        <div
          className="mb-6 rounded-lg border-l-4 p-4"
          style={{
            borderColor: VARIANT_STYLES.warning.border,
            backgroundColor: VARIANT_STYLES.warning.bg,
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" style={{ color: '#f59e0b' }} />
              <div>
                <p className="text-sm font-medium" style={{ color: '#fbbf24' }}>
                  {warningTitle}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {warningMessage}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {hasApiKeyModeIssue ? (
                <button
                  onClick={() =>
                    handleProviderManage(primaryApiKeyProvider?.providerId ?? 'anthropic')
                  }
                  className="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
                  style={{ backgroundColor: '#f59e0b' }}
                >
                  <SlidersHorizontal className="size-4" />
                  管理提供商
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setShowTroubleshoot((v) => !v)}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-colors hover:bg-white/5"
                    style={{
                      borderColor: 'var(--color-border-emphasis)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <HelpCircle className="size-3.5" />
                    已经登录？
                    {showTroubleshoot ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                  </button>
                  <button
                    onClick={() => setShowLoginTerminal(true)}
                    className="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
                    style={{ backgroundColor: '#f59e0b' }}
                  >
                    <LogIn className="size-4" />
                    登录
                  </button>
                </>
              )}
            </div>
          </div>

          {!hasApiKeyModeIssue && showTroubleshoot && (
            <div
              className="mt-3 rounded-md border p-3"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              <p
                className="mb-2 text-xs font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                如果你确认已经登录，可以尝试以下步骤：
              </p>
              <ol
                className="ml-4 list-decimal space-y-1.5 text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <li>
                  Click{' '}
                  <button
                    onClick={async () => {
                      setIsVerifyingAuth(true);
                      try {
                        await invalidateCliStatus();
                        if (multimodelEnabled) {
                          await bootstrapCliStatus({ multimodelEnabled: true });
                        } else {
                          await fetchCliStatus();
                        }
                      } finally {
                        setIsVerifyingAuth(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors hover:bg-white/10"
                    style={{
                      color: '#fbbf24',
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    }}
                  >
                    <RefreshCw className="size-3" />
                    重新检查
                  </button>{' '}
                  — 状态有时会缓存几秒钟
                </li>
                <li>
                  打开终端并运行：{' '}
                  <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
                    {renderCliStatus.showBinaryPath && renderCliStatus.binaryPath
                      ? `"${renderCliStatus.binaryPath}" auth status`
                      : '已配置 CLI 的认证状态命令'}
                  </code>{' '}
                  — 检查是否显示“Logged in”
                </li>
                <li>
                  如果终端显示已登录但应用仍无法识别，尝试：{' '}
                  <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
                    {renderCliStatus.showBinaryPath && renderCliStatus.binaryPath
                      ? `"${renderCliStatus.binaryPath}" auth logout`
                      : '运行时退出登录命令'}
                  </code>{' '}
                  然后{' '}
                  <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
                    {renderCliStatus.showBinaryPath && renderCliStatus.binaryPath
                      ? `"${renderCliStatus.binaryPath}" auth login`
                      : '运行时登录命令'}
                  </code>{' '}
                  再登录一次
                </li>
                <li>
                  确认终端里的 CLI 与应用使用的是同一个运行时
                  {renderCliStatus.showBinaryPath && renderCliStatus.binaryPath && (
                    <span>
                      :{' '}
                      <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">
                        {renderCliStatus.binaryPath}
                      </code>
                    </span>
                  )}
                </li>
              </ol>
              <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                浏览会话和项目不需要登录。只有运行 agent teams 时才需要登录。
              </p>
            </div>
          )}
        </div>
        {installedAuxiliaryUi}
        {showLoginTerminal && renderCliStatus.binaryPath && (
          <TerminalModal
            title={`${getHumanRuntimeDisplayName(renderCliStatus, multimodelEnabled)} 登录`}
            command={renderCliStatus.binaryPath}
            args={['auth', 'login']}
            onClose={() => {
              setShowLoginTerminal(false);
              setIsVerifyingAuth(true);
              void (async () => {
                try {
                  await invalidateCliStatus();
                  if (multimodelEnabled) {
                    await bootstrapCliStatus({ multimodelEnabled: true });
                  } else {
                    await fetchCliStatus();
                  }
                } finally {
                  setIsVerifyingAuth(false);
                }
              })();
            }}
            onExit={() => {
              setIsVerifyingAuth(true);
              void (async () => {
                try {
                  await invalidateCliStatus();
                  if (multimodelEnabled) {
                    await bootstrapCliStatus({ multimodelEnabled: true });
                  } else {
                    await fetchCliStatus();
                  }
                } finally {
                  setIsVerifyingAuth(false);
                }
              })();
            }}
            autoCloseOnSuccessMs={4000}
            successMessage="登录完成"
            failureMessage="登录失败"
          />
        )}
      </>
    );
  }

  // Installed — show version, path, update info
  return (
    <>
      <InstalledBanner
        cliStatus={renderCliStatus}
        sourceProviderMap={loadingCliProviderMap}
        cliStatusLoading={cliStatusLoading}
        cliProviderStatusLoading={cliProviderStatusLoading}
        codexSnapshotPending={codexSnapshotPending}
        cliStatusError={cliStatusError ?? null}
        providersCollapsed={providersCollapsed}
        isBusy={isBusy}
        onInstall={handleInstall}
        onRefresh={handleRefresh}
        onToggleProvidersCollapsed={handleToggleProvidersCollapsed}
        onProviderLogin={handleProviderLogin}
        onProviderLogout={handleProviderLogout}
        onProviderManage={handleProviderManage}
        onProviderRefresh={handleProviderRefresh}
        onCodexReconnect={handleCodexDashboardLogin}
        codexReconnectBusy={codexAccount.loading}
        variant={variant}
      />
      {installedAuxiliaryUi}
    </>
  );
};
