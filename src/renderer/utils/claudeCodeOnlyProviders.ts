import type { TeamProviderId } from '@shared/types';
import type { CliProviderId } from '@shared/types/cliInstaller';

export function filterMainScreenCliProviders<
  T extends {
    providerId: CliProviderId;
  },
>(providers: readonly T[]): T[] {
  return providers.filter((provider) => provider.providerId === 'anthropic');
}

export function normalizeCreateLaunchProviderForUi(
  _providerId: TeamProviderId | undefined,
  _multimodelEnabled: boolean
): TeamProviderId {
  return 'anthropic';
}

export function isCreateLaunchProviderDisabled(
  providerId: TeamProviderId,
  _multimodelEnabled: boolean
): boolean {
  return providerId !== 'anthropic';
}
