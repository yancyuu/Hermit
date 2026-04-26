import { normalizeOptionalTeamProviderId } from '@shared/utils/teamProvider';

import type { TeamProviderId } from '@shared/types';
import type { CliProviderId } from '@shared/types/cliInstaller';

export const GEMINI_UI_FROZEN = true;
export const GEMINI_UI_DISABLED_REASON = 'Gemini 功能仍在开发中';
export const GEMINI_UI_DISABLED_BADGE_LABEL = '开发中';

export function isGeminiUiFrozen(): boolean {
  return GEMINI_UI_FROZEN;
}

export function isGeminiProviderId(
  providerId: CliProviderId | TeamProviderId | undefined
): providerId is 'gemini' {
  return providerId === 'gemini';
}

export function filterMainScreenCliProviders<
  T extends {
    providerId: CliProviderId;
    connection?: {
      codex?: {
        launchAllowed?: boolean;
        launchReadinessState?: string | null;
      } | null;
    } | null;
  },
>(providers: readonly T[]): T[] {
  return providers.filter((provider) => {
    if (GEMINI_UI_FROZEN && provider.providerId === 'gemini') {
      return false;
    }
    if (
      provider.providerId === 'codex' &&
      provider.connection?.codex?.launchReadinessState === 'runtime_missing' &&
      provider.connection.codex.launchAllowed !== true
    ) {
      return false;
    }
    return true;
  });
}

export function normalizeCreateLaunchProviderForUi(
  providerId: TeamProviderId | undefined,
  multimodelEnabled: boolean
): TeamProviderId {
  if (!multimodelEnabled) {
    return 'anthropic';
  }

  const normalizedProviderId = normalizeOptionalTeamProviderId(providerId);
  if (normalizedProviderId === 'gemini' && GEMINI_UI_FROZEN) {
    return 'anthropic';
  }
  return normalizedProviderId ?? 'anthropic';
}

export function isCreateLaunchProviderDisabled(
  providerId: TeamProviderId,
  multimodelEnabled: boolean
): boolean {
  if (providerId === 'gemini' && GEMINI_UI_FROZEN) {
    return true;
  }
  if (!multimodelEnabled && providerId !== 'anthropic') {
    return true;
  }
  return false;
}
