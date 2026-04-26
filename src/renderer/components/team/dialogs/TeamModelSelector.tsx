import React, { useEffect, useMemo, useState } from 'react';

import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { useEffectiveCliProviderStatus } from '@renderer/hooks/useEffectiveCliProviderStatus';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import {
  GEMINI_UI_DISABLED_BADGE_LABEL,
  GEMINI_UI_DISABLED_REASON,
  isGeminiUiFrozen,
} from '@renderer/utils/geminiUiFreeze';
import {
  compareOpenCodeTeamModelRecommendations,
  getOpenCodeTeamModelRecommendation,
  isOpenCodeTeamModelRecommended,
} from '@renderer/utils/openCodeModelRecommendations';
import {
  getAvailableTeamProviderModelOptions,
  getTeamModelUiDisabledReason,
  isTeamProviderModelVerificationPending,
  normalizeTeamModelForUi,
  TEAM_MODEL_UI_DISABLED_BADGE_LABEL,
} from '@renderer/utils/teamModelAvailability';
import {
  doesTeamModelCarryProviderBrand,
  getProviderScopedTeamModelLabel,
  getRuntimeAwareProviderScopedTeamModelLabel,
  getTeamModelLabel as getCatalogTeamModelLabel,
  getTeamModelSourceBadgeLabel,
  getTeamProviderLabel as getCatalogTeamProviderLabel,
  isAnthropicHaikuTeamModel,
} from '@renderer/utils/teamModelCatalog';
import { extractProviderScopedBaseModel } from '@renderer/utils/teamModelContext';
import { resolveAnthropicLaunchModel } from '@shared/utils/anthropicLaunchModel';
import { getAnthropicDefaultTeamModel } from '@shared/utils/anthropicModelDefaults';
import { isTeamProviderId } from '@shared/utils/teamProvider';
import { AlertTriangle, CheckCircle2, Info, Search, Star } from 'lucide-react';

import type { CliProviderStatus, TeamProviderId } from '@shared/types';

export { getProviderScopedTeamModelLabel } from '@renderer/utils/teamModelCatalog';

// --- Provider definitions ---

interface ProviderDef {
  id: TeamProviderId;
  label: string;
  comingSoon: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'anthropic', label: 'Anthropic', comingSoon: false },
  { id: 'codex', label: 'Codex', comingSoon: false },
  { id: 'gemini', label: 'Gemini', comingSoon: false },
  { id: 'opencode', label: 'OpenCode', comingSoon: false },
];

const OPENCODE_UI_DISABLED_REASON = 'OpenCode 团队启动尚未就绪。';
export const OPENCODE_TEAM_LEAD_DISABLED_REASON =
  '当前阶段 OpenCode 只能作为成员运行。请使用 Anthropic、Codex 或 Gemini 作为团队负责人，再把 OpenCode 添加为成员。';
export const OPENCODE_TEAM_LEAD_DISABLED_BADGE_LABEL = '侧路';

export function getTeamModelLabel(model: string): string {
  return getCatalogTeamModelLabel(model) ?? model;
}

export function getTeamProviderLabel(providerId: TeamProviderId): string {
  return getCatalogTeamProviderLabel(providerId) ?? 'Anthropic';
}

export function getTeamEffortLabel(effort: string): string {
  const trimmed = effort.trim();
  if (!trimmed) return '默认';
  if (trimmed === 'none') return '无';
  if (trimmed === 'minimal') return '极低';
  if (trimmed === 'low') return '低';
  if (trimmed === 'medium') return '中';
  if (trimmed === 'high') return '高';
  if (trimmed === 'xhigh') return 'XHigh';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function localizeModelOptionLabel(label: string): string {
  return label === 'Default' ? '默认' : label;
}

export function formatTeamModelSummary(
  providerId: TeamProviderId,
  model: string,
  effort?: string
): string {
  const providerLabel = getTeamProviderLabel(providerId);
  const routeLabel =
    providerId === 'opencode'
      ? (getTeamModelSourceBadgeLabel(providerId, model.trim()) ?? providerLabel)
      : providerLabel;
  const rawModelLabel = model.trim() ? getTeamModelLabel(model.trim()) : '默认';
  const modelLabel = model.trim()
    ? getProviderScopedTeamModelLabel(providerId, model.trim())
    : '默认';
  const effortLabel = effort?.trim() ? getTeamEffortLabel(effort) : '';

  const modelAlreadyCarriesProviderBrand =
    doesTeamModelCarryProviderBrand(providerId, rawModelLabel) ||
    (providerId === 'codex' && model.trim().toLowerCase().startsWith('gpt-'));
  const providerActsAsBackendOnly =
    providerId !== 'anthropic' && modelLabel !== '默认' && !modelAlreadyCarriesProviderBrand;

  const parts = modelAlreadyCarriesProviderBrand
    ? [modelLabel, effortLabel]
    : providerActsAsBackendOnly
      ? [modelLabel, `经由 ${routeLabel}`, effortLabel]
      : [providerLabel, modelLabel, effortLabel];

  return parts.filter(Boolean).join(' · ');
}

/**
 * Computes the effective model string for team provisioning.
 * By default adds [1m] suffix for 1M context (Opus/Sonnet).
 * When limitContext=true, returns base model without [1m] (200K context).
 * Haiku does not support 1M — always returned as-is.
 */
export function computeEffectiveTeamModel(
  selectedModel: string,
  limitContext: boolean,
  providerId: TeamProviderId = 'anthropic',
  providerStatus?: Pick<CliProviderStatus, 'providerId' | 'modelCatalog'> | null
): string | undefined {
  if (providerId !== 'anthropic') {
    return selectedModel.trim() || undefined;
  }

  const catalog =
    providerStatus?.providerId === 'anthropic' ? (providerStatus.modelCatalog ?? null) : null;

  return (
    resolveAnthropicLaunchModel({
      selectedModel,
      limitContext,
      availableLaunchModels: catalog?.models.map((model) => model.launchModel),
      defaultLaunchModel: catalog?.defaultLaunchModel ?? null,
    }) ?? getAnthropicDefaultTeamModel(limitContext)
  );
}

export interface TeamModelSelectorProps {
  providerId: TeamProviderId;
  onProviderChange: (providerId: TeamProviderId) => void;
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  disableGeminiOption?: boolean;
  providerDisabledReasonById?: Partial<Record<TeamProviderId, string | null | undefined>>;
  providerDisabledBadgeLabelById?: Partial<Record<TeamProviderId, string | null | undefined>>;
  modelIssueReasonByValue?: Partial<Record<string, string | null | undefined>>;
}

export const TeamModelSelector: React.FC<TeamModelSelectorProps> = ({
  providerId,
  onProviderChange,
  value,
  onValueChange,
  id,
  disableGeminiOption = false,
  providerDisabledReasonById,
  providerDisabledBadgeLabelById,
  modelIssueReasonByValue,
}) => {
  const multimodelEnabled = useStore((s) => s.appConfig?.general?.multimodelEnabled ?? true);
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [modelQuery, setModelQuery] = useState('');

  const effectiveProviderId =
    disableGeminiOption && isGeminiUiFrozen() && providerId === 'gemini' ? 'anthropic' : providerId;
  const {
    cliStatus: effectiveCliStatus,
    providerStatus: runtimeProviderStatus,
    loading: effectiveCliStatusLoading,
  } = useEffectiveCliProviderStatus(effectiveProviderId);
  const multimodelAvailable =
    multimodelEnabled || effectiveCliStatus?.flavor === 'agent_teams_orchestrator';
  const runtimeProviderStatusById = useMemo(
    () =>
      new Map(
        (effectiveCliStatus?.providers ?? []).map((provider) => [provider.providerId, provider])
      ),
    [effectiveCliStatus?.providers]
  );
  const defaultModelTooltip = useMemo(() => {
    if (effectiveProviderId === 'anthropic') {
      const defaultLongContextModel =
        getRuntimeAwareProviderScopedTeamModelLabel(
          'anthropic',
          getAnthropicDefaultTeamModel(false),
          runtimeProviderStatus
        ) ?? 'Opus 4.7 (1M)';
      const defaultLimitedContextModel =
        getRuntimeAwareProviderScopedTeamModelLabel(
          'anthropic',
          getAnthropicDefaultTeamModel(true),
          runtimeProviderStatus
        ) ?? 'Opus 4.7';

      return `使用 Claude 团队默认模型。\n默认解析为 ${defaultLongContextModel}（1M 上下文）；启用 200K 限制后解析为 ${defaultLimitedContextModel}。`;
    }
    return '使用当前提供商的运行时默认模型。';
  }, [effectiveProviderId, runtimeProviderStatus]);
  const getProviderDisabledReason = (candidateProviderId: string): string | null => {
    if (isTeamProviderId(candidateProviderId)) {
      const overrideReason = providerDisabledReasonById?.[candidateProviderId]?.trim();
      if (overrideReason) {
        return overrideReason;
      }
    }

    if (candidateProviderId === 'opencode') {
      const providerStatus = runtimeProviderStatusById.get('opencode') ?? null;
      if (!providerStatus) {
        return 'OpenCode 运行时状态仍在加载。';
      }
      if (!providerStatus.supported) {
        return (
          providerStatus.detailMessage ?? providerStatus.statusMessage ?? '尚未安装 OpenCode CLI。'
        );
      }
      if (!providerStatus.authenticated) {
        return (
          providerStatus.detailMessage ??
          providerStatus.statusMessage ??
          'OpenCode 尚未连接提供商。'
        );
      }
      if (!providerStatus.capabilities.teamLaunch) {
        return (
          providerStatus.detailMessage ??
          providerStatus.statusMessage ??
          OPENCODE_UI_DISABLED_REASON
        );
      }
      return null;
    }
    if (disableGeminiOption && isGeminiUiFrozen() && candidateProviderId === 'gemini') {
      return GEMINI_UI_DISABLED_REASON;
    }
    return null;
  };
  const isProviderTemporarilyDisabled = (candidateProviderId: string): boolean =>
    getProviderDisabledReason(candidateProviderId) !== null;
  const isProviderSelectable = (candidateProviderId: string): boolean =>
    !isProviderTemporarilyDisabled(candidateProviderId) &&
    (multimodelAvailable || candidateProviderId === 'anthropic');
  const activeProviderSelectable = isProviderSelectable(effectiveProviderId);
  const getProviderStatusBadge = (candidateProviderId: string): string | null => {
    if (isTeamProviderId(candidateProviderId)) {
      const overrideReason = providerDisabledReasonById?.[candidateProviderId]?.trim();
      const overrideBadge = providerDisabledBadgeLabelById?.[candidateProviderId]?.trim();
      if (overrideReason && overrideBadge) {
        return overrideBadge;
      }
    }

    if (candidateProviderId === 'opencode') {
      return getProviderDisabledReason(candidateProviderId) ? '受限' : null;
    }

    const providerDisabledReason = getProviderDisabledReason(candidateProviderId);
    if (providerDisabledReason) {
      return GEMINI_UI_DISABLED_BADGE_LABEL;
    }

    if (!isProviderSelectable(candidateProviderId)) {
      return '多模型关闭';
    }

    return null;
  };
  const getProviderStatusBadgeLabel = (statusBadge: string | null): string | null => {
    if (statusBadge === '受限') {
      return '受限';
    }

    if (statusBadge === '多模型关闭') {
      return '关闭';
    }

    return statusBadge;
  };
  const shouldAwaitRuntimeModelList =
    effectiveProviderId !== 'anthropic' &&
    (runtimeProviderStatus == null ||
      isTeamProviderModelVerificationPending(effectiveProviderId, runtimeProviderStatus));
  const normalizedValue = normalizeTeamModelForUi(
    effectiveProviderId,
    value,
    runtimeProviderStatus
  );

  useEffect(() => {
    if (normalizedValue !== value) {
      onValueChange(normalizedValue);
    }
  }, [normalizedValue, onValueChange, value]);

  const modelOptions = useMemo(() => {
    if (shouldAwaitRuntimeModelList) {
      return [{ value: '', label: '默认', badgeLabel: '默认' }];
    }
    return getAvailableTeamProviderModelOptions(effectiveProviderId, runtimeProviderStatus);
  }, [effectiveProviderId, runtimeProviderStatus, shouldAwaitRuntimeModelList]);
  const hasRecommendedOpenCodeModels = useMemo(
    () =>
      effectiveProviderId === 'opencode' &&
      modelOptions.some((option) => isOpenCodeTeamModelRecommended(option.value)),
    [effectiveProviderId, modelOptions]
  );

  useEffect(() => {
    if (effectiveProviderId !== 'opencode' || !hasRecommendedOpenCodeModels) {
      setRecommendedOnly(false);
    }
  }, [effectiveProviderId, hasRecommendedOpenCodeModels]);

  useEffect(() => {
    setModelQuery('');
  }, [effectiveProviderId]);

  const visibleModelOptions = useMemo(() => {
    const normalizedModelQuery = modelQuery.trim().toLowerCase();
    const matchesModelQuery = (option: (typeof modelOptions)[number]): boolean => {
      if (!normalizedModelQuery) {
        return true;
      }
      const modelRecommendation =
        effectiveProviderId === 'opencode'
          ? getOpenCodeTeamModelRecommendation(option.value)
          : null;
      return [
        option.value,
        option.label,
        option.badgeLabel ?? '',
        modelRecommendation?.label ?? '',
        modelRecommendation?.reason ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedModelQuery);
    };

    if (effectiveProviderId !== 'opencode') {
      return modelOptions.filter(matchesModelQuery);
    }

    const concreteOptions = modelOptions
      .filter((option) => option.value.trim().length > 0)
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !recommendedOnly || isOpenCodeTeamModelRecommended(option.value))
      .filter(({ option }) => matchesModelQuery(option))
      .sort((left, right) => {
        const recommendationOrder = compareOpenCodeTeamModelRecommendations(
          left.option.value,
          right.option.value
        );
        return recommendationOrder || left.index - right.index;
      })
      .map(({ option }) => option);

    if (recommendedOnly) {
      return concreteOptions;
    }

    return [
      ...modelOptions.filter((option) => option.value.trim().length === 0),
      ...concreteOptions,
    ].filter(matchesModelQuery);
  }, [effectiveProviderId, modelOptions, modelQuery, recommendedOnly]);
  const concreteModelOptionCount = modelOptions.filter((option) => option.value.trim()).length;
  const shouldShowModelSearch = concreteModelOptionCount > 8;
  const trimmedModelQuery = modelQuery.trim();
  const shouldConstrainModelListHeight = visibleModelOptions.length > 8;

  return (
    <div className="mb-5">
      <Label htmlFor={id} className="label-optional mb-1.5 block">
        模型（可选）
      </Label>
      <Tabs
        value={effectiveProviderId}
        onValueChange={(nextValue) => {
          if (isTeamProviderId(nextValue) && isProviderSelectable(nextValue)) {
            onProviderChange(nextValue);
          }
        }}
      >
        <div className="space-y-0">
          <div className="-mb-px border-b border-[var(--color-border-subtle)]">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-none bg-transparent p-0">
              {PROVIDERS.map((provider) => {
                const providerDisabledReason = getProviderDisabledReason(provider.id);
                const providerSelectable = isProviderSelectable(provider.id);
                const statusBadge = getProviderStatusBadge(provider.id);
                const statusBadgeLabel = getProviderStatusBadgeLabel(statusBadge);

                return (
                  <TabsTrigger
                    key={provider.id}
                    value={provider.id}
                    disabled={provider.comingSoon || !providerSelectable}
                    title={
                      providerDisabledReason ??
                      (statusBadge === '多模型关闭'
                        ? '启用多模型模式后才能使用该提供商。'
                        : (statusBadge ?? undefined))
                    }
                    className={cn(
                      "relative h-12 min-w-[128px] items-center justify-start gap-2 rounded-b-none border border-b-0 border-transparent px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] data-[state=active]:z-10 data-[state=active]:-mb-px data-[state=active]:border-[var(--color-border)] data-[state=active]:bg-[var(--color-surface)] data-[state=active]:text-[var(--color-text)] data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-px data-[state=active]:after:bg-[var(--color-surface)] data-[state=active]:after:content-['']",
                      !providerSelectable && 'opacity-50'
                    )}
                  >
                    <ProviderBrandLogo providerId={provider.id} className="size-5 shrink-0" />
                    <span
                      className={cn(
                        'min-w-0 truncate text-sm font-medium',
                        statusBadgeLabel && 'pr-9'
                      )}
                    >
                      {provider.label}
                    </span>
                    {statusBadgeLabel ? (
                      <span
                        className="absolute right-2 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]"
                        style={{
                          color: 'var(--color-text-muted)',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        }}
                        aria-label={statusBadge ?? undefined}
                        title={statusBadge ?? undefined}
                      >
                        {statusBadgeLabel}
                      </span>
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <div className="rounded-b-md border border-t-0 border-[var(--color-border)] bg-[var(--color-surface)]">
            {!multimodelAvailable ? (
              <div className="border-b border-[var(--color-border-subtle)] px-3 py-2">
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Codex 和 Gemini 需要启用多模型模式。
                </p>
              </div>
            ) : null}

            <div className="p-3">
              {shouldAwaitRuntimeModelList ? (
                <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
                  显式模型列表会从当前运行时加载。列表同步期间仍可使用默认模型。
                </p>
              ) : null}
              {shouldShowModelSearch ? (
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <Input
                    data-testid="team-model-selector-model-search"
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder="搜索模型"
                    aria-label="搜索模型"
                    className="h-9 pr-3 text-sm"
                    style={{ paddingLeft: 40 }}
                  />
                </div>
              ) : null}
              {hasRecommendedOpenCodeModels ? (
                <div className="mb-2 flex w-fit items-center gap-2">
                  <Checkbox
                    id="opencode-team-model-recommended-only"
                    checked={recommendedOnly}
                    onCheckedChange={(checked) => setRecommendedOnly(checked === true)}
                    className="size-3.5"
                  />
                  <Label
                    htmlFor="opencode-team-model-recommended-only"
                    className="cursor-pointer text-[11px] font-normal text-[var(--color-text-secondary)]"
                  >
                    仅显示推荐模型
                  </Label>
                </div>
              ) : null}
              <div
                data-testid="team-model-selector-model-grid"
                className={cn(
                  'grid gap-1.5 rounded-md bg-[var(--color-surface)]',
                  shouldConstrainModelListHeight && 'overflow-y-auto pr-1'
                )}
                style={{
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  maxHeight: shouldConstrainModelListHeight ? 400 : undefined,
                }}
              >
                {visibleModelOptions.map((opt) =>
                  (() => {
                    const modelDisabledReason = getTeamModelUiDisabledReason(
                      effectiveProviderId,
                      opt.value,
                      runtimeProviderStatus
                    );
                    const availabilityStatus =
                      opt.value === '' ? 'available' : (opt.availabilityStatus ?? 'available');
                    const availabilityReason =
                      opt.value === '' ? null : (opt.availabilityReason ?? null);
                    const modelIssueReason =
                      opt.value === '' ? null : (modelIssueReasonByValue?.[opt.value] ?? null);
                    const hasModelIssue = Boolean(modelIssueReason);
                    const modelSelectable =
                      activeProviderSelectable &&
                      !modelDisabledReason &&
                      (opt.value === '' ||
                        availabilityStatus == null ||
                        availabilityStatus === 'available');
                    const modelStatusMessage =
                      modelIssueReason ?? modelDisabledReason ?? availabilityReason ?? null;
                    const sourceBadgeLabel =
                      effectiveProviderId === 'opencode' && opt.value !== ''
                        ? opt.badgeLabel?.trim() || null
                        : null;
                    const modelRecommendation =
                      effectiveProviderId === 'opencode'
                        ? getOpenCodeTeamModelRecommendation(opt.value)
                        : null;

                    return (
                      <button
                        key={opt.value || '__default__'}
                        type="button"
                        id={opt.value === normalizedValue ? id : undefined}
                        aria-disabled={!modelSelectable}
                        title={modelStatusMessage ?? undefined}
                        className={cn(
                          'flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border bg-[var(--color-surface)] px-3 py-2 text-center text-xs font-medium transition-[background-color,border-color,color,box-shadow] duration-150',
                          hasModelIssue && normalizedValue === opt.value
                            ? 'border-red-500/60 bg-red-500/10 text-red-100 shadow-sm'
                            : hasModelIssue
                              ? 'border-red-500/40 bg-red-500/5 text-red-200 hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-100'
                              : normalizedValue === opt.value
                                ? 'border-[var(--color-border-emphasis)] bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-sm'
                                : modelSelectable
                                  ? 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-emphasis)] hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_62%,var(--color-surface)_38%)] hover:text-[var(--color-text-secondary)] hover:shadow-sm'
                                  : 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)]',
                          !modelSelectable && 'cursor-not-allowed opacity-45',
                          !modelDisabledReason && !activeProviderSelectable && 'pointer-events-none'
                        )}
                        onClick={() => {
                          if (!modelSelectable) return;
                          onValueChange(opt.value);
                        }}
                      >
                        <span className="flex flex-col items-center justify-center gap-0.5">
                          <span className="leading-tight">
                            {localizeModelOptionLabel(opt.label)}
                          </span>
                          {sourceBadgeLabel ? (
                            <span
                              className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                borderColor: 'var(--color-border-subtle)',
                                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                                color: 'var(--color-text-secondary)',
                              }}
                              title={`来源：${sourceBadgeLabel}`}
                            >
                              {sourceBadgeLabel}
                            </span>
                          ) : null}
                          {modelRecommendation ? (
                            <span
                              className={cn(
                                'inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                modelRecommendation.level === 'recommended'
                                  ? 'bg-emerald-300/12 border-emerald-300/35 text-emerald-200'
                                  : modelRecommendation.level === 'recommended-with-limits'
                                    ? 'bg-amber-300/12 border-amber-300/35 text-amber-200'
                                    : modelRecommendation.level === 'tested'
                                      ? 'bg-sky-300/12 border-sky-300/35 text-sky-200'
                                      : modelRecommendation.level === 'tested-with-limits'
                                        ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-200'
                                        : modelRecommendation.level === 'unavailable-in-opencode'
                                          ? 'border-slate-300/30 bg-slate-400/10 text-slate-200'
                                          : 'border-red-300/35 bg-red-400/10 text-red-200'
                              )}
                              title={modelRecommendation.reason}
                            >
                              {modelRecommendation.level === 'not-recommended' ||
                              modelRecommendation.level === 'unavailable-in-opencode' ? (
                                <AlertTriangle className="size-3 shrink-0" />
                              ) : modelRecommendation.level === 'tested' ||
                                modelRecommendation.level === 'tested-with-limits' ? (
                                <CheckCircle2 className="size-3 shrink-0" />
                              ) : (
                                <Star className="size-3 shrink-0 fill-current" />
                              )}
                              <span>{modelRecommendation.label}</span>
                            </span>
                          ) : null}
                          {opt.value === '' && (
                            <span className="flex items-center justify-center gap-1">
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger
                                    asChild
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                  >
                                    <Info className="size-3 shrink-0 opacity-40 transition-opacity hover:opacity-70" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[240px] text-xs">
                                    {defaultModelTooltip.split('\n').map((line, index) => (
                                      <React.Fragment key={line}>
                                        {index > 0 ? <br /> : null}
                                        {line}
                                      </React.Fragment>
                                    ))}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </span>
                          )}
                          {hasModelIssue && (
                            <span
                              className="flex items-center justify-center gap-1 text-[10px] font-normal text-red-300"
                              title={modelIssueReason ?? undefined}
                            >
                              <AlertTriangle className="size-3 shrink-0" />
                              <span>问题</span>
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger
                                    asChild
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                  >
                                    <Info className="size-3 shrink-0 opacity-50 transition-opacity hover:opacity-80" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[240px] text-xs">
                                    {modelIssueReason}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </span>
                          )}
                          {!hasModelIssue && modelDisabledReason && (
                            <span
                              className="flex items-center justify-center gap-1 text-[10px] font-normal text-[var(--color-text-muted)]"
                              title={modelDisabledReason}
                            >
                              <span>{TEAM_MODEL_UI_DISABLED_BADGE_LABEL}</span>
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger
                                    asChild
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                  >
                                    <Info className="size-3 shrink-0 opacity-40 transition-opacity hover:opacity-70" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[240px] text-xs">
                                    {modelDisabledReason}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })()
                )}
              </div>
              {visibleModelOptions.length === 0 ? (
                <div className="rounded-md border border-white/10 px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  {trimmedModelQuery
                    ? '没有匹配该搜索的模型。'
                    : effectiveProviderId === 'opencode' && recommendedOnly
                      ? '当前运行时列表中没有可用的推荐 OpenCode 模型。'
                      : '当前运行时列表中没有可用模型。'}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
};
