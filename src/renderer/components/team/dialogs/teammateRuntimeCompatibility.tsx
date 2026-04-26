import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { parseCliArgs } from '@shared/utils/cliArgsParser';
import { migrateProviderBackendId } from '@shared/utils/providerBackend';
import { normalizeOptionalTeamProviderId } from '@shared/utils/teamProvider';

import type { TmuxStatus } from '@features/tmux-installer/contracts';
import type { TeamProviderId } from '@shared/types';

type TeammateRuntimeIssueReason =
  | 'mixed-provider'
  | 'codex-native-runtime'
  | 'explicit-tmux-mode'
  | 'opencode-led-mixed-unsupported';

interface RuntimeMemberInput {
  id?: string;
  name: string;
  providerId?: TeamProviderId;
  providerBackendId?: string | null;
  removedAt?: number | string | null;
}

interface RuntimeIssue {
  reason: TeammateRuntimeIssueReason;
  memberId?: string;
  memberName?: string;
  memberProviderId?: TeamProviderId;
}

export interface TeammateRuntimeCompatibility {
  visible: boolean;
  blocksSubmission: boolean;
  checking: boolean;
  title: string;
  message: string;
  details: string[];
  tmuxDetail: string | null;
  memberWarningById: Record<string, string>;
}

interface AnalyzeTeammateRuntimeCompatibilityInput {
  leadProviderId: TeamProviderId;
  leadProviderBackendId?: string | null;
  members: readonly RuntimeMemberInput[];
  soloTeam?: boolean;
  extraCliArgs?: string;
  tmuxStatus: TmuxStatus | null;
  tmuxStatusLoading: boolean;
  tmuxStatusError: string | null;
}

export interface TmuxRuntimeReadiness {
  status: TmuxStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PROVIDER_LABELS: Record<TeamProviderId, string> = {
  anthropic: 'Anthropic',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

function getProviderLabel(providerId: TeamProviderId): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

function getExplicitTeammateMode(
  rawExtraCliArgs: string | undefined
): 'auto' | 'tmux' | 'in-process' | null {
  const tokens = parseCliArgs(rawExtraCliArgs);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    // eslint-disable-next-line security/detect-possible-timing-attacks -- parsing UI CLI flags, not comparing secrets
    if (token === '--teammate-mode') {
      const value = tokens[index + 1];
      return value === 'auto' || value === 'tmux' || value === 'in-process' ? value : null;
    }
    if (token.startsWith('--teammate-mode=')) {
      const value = token.slice('--teammate-mode='.length);
      return value === 'auto' || value === 'tmux' || value === 'in-process' ? value : null;
    }
  }
  return null;
}

function isTmuxRuntimeReady(status: TmuxStatus | null): boolean {
  return status?.effective.available === true && status.effective.runtimeReady === true;
}

function getTmuxDetail(status: TmuxStatus | null, error: string | null): string | null {
  if (error) {
    return error;
  }
  return status?.effective.detail ?? status?.wsl?.statusDetail ?? status?.error ?? null;
}

function summarizeIssueNames(
  issues: readonly RuntimeIssue[],
  reason: TeammateRuntimeIssueReason
): string {
  const names = issues
    .filter((issue) => issue.reason === reason)
    .map((issue) => issue.memberName)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) {
    return '';
  }
  if (names.length <= 3) {
    return names.join(', ');
  }
  return `${names.slice(0, 3).join(', ')} 等 ${names.length} 个成员`;
}

export function analyzeTeammateRuntimeCompatibility({
  leadProviderId,
  leadProviderBackendId,
  members,
  soloTeam = false,
  extraCliArgs,
  tmuxStatus,
  tmuxStatusLoading,
  tmuxStatusError,
}: AnalyzeTeammateRuntimeCompatibilityInput): TeammateRuntimeCompatibility {
  const activeMembers = soloTeam
    ? []
    : members.filter((member) => member.removedAt == null && member.name.trim().length > 0);
  const explicitTeammateMode = getExplicitTeammateMode(extraCliArgs);
  const leadBackendId = migrateProviderBackendId(leadProviderId, leadProviderBackendId);
  const issues: RuntimeIssue[] = [];

  if (explicitTeammateMode === 'tmux' && activeMembers.length > 0) {
    issues.push({ reason: 'explicit-tmux-mode' });
  }

  for (const member of activeMembers) {
    const memberProviderId = normalizeOptionalTeamProviderId(member.providerId) ?? leadProviderId;
    const memberName = member.name.trim();
    if (memberProviderId !== leadProviderId) {
      if (leadProviderId !== 'opencode' && memberProviderId === 'opencode') {
        continue;
      }
      if (leadProviderId === 'opencode') {
        issues.push({
          reason: 'opencode-led-mixed-unsupported',
          memberId: member.id,
          memberName,
          memberProviderId,
        });
        continue;
      }
      issues.push({
        reason: 'mixed-provider',
        memberId: member.id,
        memberName,
        memberProviderId,
      });
      continue;
    }

    const memberBackendId = migrateProviderBackendId(
      memberProviderId,
      member.providerBackendId ?? leadBackendId
    );
    if (memberProviderId === 'codex' && memberBackendId === 'codex-native') {
      issues.push({
        reason: 'codex-native-runtime',
        memberId: member.id,
        memberName,
        memberProviderId,
      });
    }
  }

  if (issues.length === 0) {
    return {
      visible: false,
      blocksSubmission: false,
      checking: false,
      title: '',
      message: '',
      details: [],
      tmuxDetail: null,
      memberWarningById: {},
    };
  }

  const tmuxReady = isTmuxRuntimeReady(tmuxStatus);
  const hasOpenCodeLeadMixedUnsupported = issues.some(
    (issue) => issue.reason === 'opencode-led-mixed-unsupported'
  );
  if (tmuxReady && !hasOpenCodeLeadMixedUnsupported) {
    return {
      visible: false,
      blocksSubmission: false,
      checking: false,
      title: '',
      message: '',
      details: [],
      tmuxDetail: null,
      memberWarningById: {},
    };
  }

  const checking = !hasOpenCodeLeadMixedUnsupported && tmuxStatusLoading && !tmuxStatus;
  const blocksSubmission = true;
  const hasMixedProviders = issues.some((issue) => issue.reason === 'mixed-provider');
  const hasCodexNative = issues.some((issue) => issue.reason === 'codex-native-runtime');
  const hasExplicitTmux = issues.some((issue) => issue.reason === 'explicit-tmux-mode');
  const details: string[] = [];
  const memberWarningById: Record<string, string> = {};

  if (hasMixedProviders) {
    const names = summarizeIssueNames(issues, 'mixed-provider');
    details.push(
      names
        ? `混合提供商：${names} 使用的提供商与 ${getProviderLabel(leadProviderId)} 负责人不同。`
        : '混合提供商需要独立成员进程。'
    );
  }
  if (hasOpenCodeLeadMixedUnsupported) {
    const names = summarizeIssueNames(issues, 'opencode-led-mixed-unsupported');
    details.push(
      names
        ? `OpenCode 负责人混合团队：${names} 使用了非 OpenCode 提供商。`
        : '当前阶段不支持由 OpenCode 作为负责人的混合提供商团队。'
    );
  }
  if (hasCodexNative) {
    const names = summarizeIssueNames(issues, 'codex-native-runtime');
    details.push(
      names
        ? `Codex 原生成员：${names} 必须通过独立 Codex 进程运行。`
        : 'Codex 原生成员必须通过独立 Codex 进程运行。'
    );
  }
  if (hasExplicitTmux) {
    details.push('自定义 CLI 参数强制使用 --teammate-mode tmux。');
  }
  if (hasOpenCodeLeadMixedUnsupported) {
    details.push(
      '修复：混用 OpenCode 和其他提供商时，请让团队负责人使用 Anthropic、Codex 或 Gemini。'
    );
  } else {
    details.push(
      hasCodexNative && !hasMixedProviders
        ? '修复：安装 tmux/WSL tmux，使用单人团队，或选择支持进程内成员的同提供商运行时。'
        : '修复：安装 tmux/WSL tmux，使用单人团队，或让所有成员使用与负责人相同的非 Codex 原生提供商。'
    );
  }

  for (const issue of issues) {
    if (!issue.memberId || !issue.memberName) {
      continue;
    }
    if (issue.reason === 'mixed-provider') {
      memberWarningById[issue.memberId] =
        `${issue.memberName} 使用 ${getProviderLabel(issue.memberProviderId ?? leadProviderId)}。` +
        `没有 tmux 时，成员必须与 ${getProviderLabel(leadProviderId)} 负责人使用相同提供商。`;
    } else if (issue.reason === 'codex-native-runtime') {
      memberWarningById[issue.memberId] =
        `${issue.memberName} 使用 Codex 原生运行时。Codex 原生成员需要独立进程，目前依赖 tmux。`;
    } else if (issue.reason === 'opencode-led-mixed-unsupported') {
      memberWarningById[issue.memberId] =
        `${issue.memberName} 使用 ${getProviderLabel(issue.memberProviderId ?? leadProviderId)}。` +
        '当前阶段混合提供商时，OpenCode 不能作为团队负责人。';
    }
  }

  return {
    visible: blocksSubmission || checking,
    blocksSubmission,
    checking,
    title: checking
      ? '正在检查 tmux 成员运行支持'
      : hasOpenCodeLeadMixedUnsupported
        ? 'OpenCode 不能负责混合提供商团队'
        : hasCodexNative && !hasMixedProviders
          ? 'Codex 成员运行前需要 tmux'
          : '该团队运行前需要 tmux',
    message: checking
      ? '部分成员需要独立进程。应用正在检查 tmux 是否可用。'
      : hasOpenCodeLeadMixedUnsupported
        ? 'OpenCode 成员可以作为 Anthropic、Codex 或 Gemini 负责人的次级运行通道，但当前阶段不支持 OpenCode 负责混合团队。'
        : hasCodexNative && !hasMixedProviders
          ? 'Codex 负责人可以不依赖 tmux 运行，但 Codex 原生成员不能使用进程内成员适配器，必须作为独立 Codex 进程启动，而该路径当前需要 tmux。'
          : '这台机器上的 tmux 尚未就绪。同提供商进程内成员可以不依赖 tmux，但该团队存在需要独立进程的成员。',
    details,
    tmuxDetail: getTmuxDetail(tmuxStatus, tmuxStatusError),
    memberWarningById,
  };
}

export function useTmuxRuntimeReadiness(enabled: boolean): TmuxRuntimeReadiness {
  const [status, setStatus] = useState<TmuxStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (typeof api.tmux?.getStatus !== 'function') {
        throw new Error('tmux status API is not available. Restart the app.');
      }
      const nextStatus = await api.tmux.getStatus();
      setStatus(nextStatus);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load tmux status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    if (typeof api.tmux?.onProgress !== 'function') {
      return undefined;
    }
    return api.tmux.onProgress(() => {
      void refresh();
    });
  }, [enabled, refresh]);

  const effectiveLoading = enabled && (loading || (!status && !error));

  return useMemo(
    () => ({
      status,
      loading: effectiveLoading,
      error,
      refresh,
    }),
    [effectiveLoading, error, refresh, status]
  );
}
