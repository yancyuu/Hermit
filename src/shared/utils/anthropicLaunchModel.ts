import { getAnthropicDefaultTeamModel } from './anthropicModelDefaults';
import { isDefaultProviderModelSelection } from './providerModelSelection';

function stripOneMillionSuffix(model: string): string {
  return model.replace(/(?:\[1m\])+$/i, '');
}

function normalizeAvailableLaunchModels(
  availableLaunchModels: Iterable<string> | undefined
): Set<string> {
  const normalized = new Set<string>();
  for (const model of availableLaunchModels ?? []) {
    const trimmed = model.trim();
    if (trimmed) {
      normalized.add(trimmed);
    }
  }
  return normalized;
}

function chooseAvailableModel(
  availableModels: Set<string>,
  candidates: readonly string[]
): string | null {
  if (availableModels.size === 0) {
    return null;
  }

  for (const candidate of candidates) {
    if (availableModels.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveAnthropicLaunchModel(params: {
  selectedModel?: string | null;
  limitContext?: boolean;
  availableLaunchModels?: Iterable<string>;
  defaultLaunchModel?: string | null;
}): string | null {
  const selectedModel = params.selectedModel?.trim() ?? '';
  const availableModels = normalizeAvailableLaunchModels(params.availableLaunchModels);

  if (!selectedModel || isDefaultProviderModelSelection(selectedModel)) {
    const staticDefault = getAnthropicDefaultTeamModel(params.limitContext);
    const runtimeDefault = params.defaultLaunchModel?.trim() || null;
    const preferredDefault = stripOneMillionSuffix(staticDefault) || staticDefault;
    if (availableModels.size === 0) {
      return preferredDefault;
    }

    return (
      chooseAvailableModel(availableModels, [
        preferredDefault,
        stripOneMillionSuffix(runtimeDefault || preferredDefault),
        staticDefault,
        stripOneMillionSuffix(staticDefault),
      ]) ?? preferredDefault
    );
  }

  const baseModel = stripOneMillionSuffix(selectedModel);
  if (!baseModel) {
    return null;
  }

  return baseModel;
}
