import {
  doesTeamModelCarryProviderBrand,
  getTeamModelLabel,
  getTeamProviderLabel,
} from './teamModelCatalog';

import type { TeamProviderId } from '@shared/types';

export function getTeamRuntimeModelLabel(model: string | undefined): string | undefined {
  return getTeamModelLabel(model);
}

export function getTeamRuntimeProviderLabel(
  providerId: TeamProviderId | undefined
): string | undefined {
  return getTeamProviderLabel(providerId);
}

export function getTeamRuntimeEffortLabel(effort: string | undefined): string | undefined {
  const trimmed = effort?.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'low') return '低';
  if (trimmed === 'medium') return '中';
  if (trimmed === 'high') return '高';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function formatTeamRuntimeSummary(
  providerId: TeamProviderId | undefined,
  model: string | undefined,
  effort?: string
): string | undefined {
  const providerLabel = getTeamRuntimeProviderLabel(providerId);
  const modelLabel = getTeamRuntimeModelLabel(model);
  const effortLabel = getTeamRuntimeEffortLabel(effort);

  if (!providerLabel && !modelLabel && !effortLabel) {
    return undefined;
  }

  const modelAlreadyCarriesProviderBrand = doesTeamModelCarryProviderBrand(providerId, modelLabel);

  const providerActsAsBackendOnly =
    providerId !== 'anthropic' && Boolean(modelLabel) && !modelAlreadyCarriesProviderBrand;

  const parts = modelAlreadyCarriesProviderBrand
    ? [modelLabel, effortLabel]
    : providerActsAsBackendOnly
      ? [modelLabel, `经由 ${providerLabel}`, effortLabel]
      : [providerLabel, providerLabel && !modelLabel ? '默认' : modelLabel, effortLabel];

  return parts.filter(Boolean).join(' · ');
}
