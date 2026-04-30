import { describe, expect, it } from 'vitest';

import {
  reconcileAnthropicRuntimeSelections,
  resolveAnthropicFastMode,
  resolveAnthropicRuntimeSelection,
} from '@features/anthropic-runtime-profile/renderer';
import type { CliProviderModelCatalog, CliProviderRuntimeCapabilities } from '@shared/types';

import type { AnthropicRuntimeProfileSource } from '@features/anthropic-runtime-profile/renderer';

function createAnthropicSource(options: {
  models: CliProviderModelCatalog['models'];
  defaultLaunchModel?: string;
  fastMode?: CliProviderRuntimeCapabilities['fastMode'];
}): AnthropicRuntimeProfileSource {
  return {
    modelCatalog: {
      schemaVersion: 1 as const,
      providerId: 'anthropic' as const,
      source: 'anthropic-models-api' as const,
      status: 'ready' as const,
      fetchedAt: '2026-04-21T00:00:00.000Z',
      staleAt: '2026-04-21T00:10:00.000Z',
      defaultModelId: options.defaultLaunchModel ?? options.models[0]?.id ?? 'opus[1m]',
      defaultLaunchModel: options.defaultLaunchModel ?? options.models[0]?.launchModel ?? 'opus[1m]',
      models: options.models,
      diagnostics: {
        configReadState: 'ready',
        appServerState: 'healthy',
      },
    },
    runtimeCapabilities: {
      modelCatalog: {
        dynamic: true,
        source: 'anthropic-models-api' as const,
      },
      reasoningEffort: {
        supported: true,
        values: ['low', 'medium', 'high', 'max'],
        configPassthrough: true,
      },
      fastMode: options.fastMode ?? {
        supported: true,
        available: true,
        reason: null,
        source: 'runtime' as const,
      },
    },
  };
}

describe('resolveAnthropicRuntimeProfile', () => {
  it('uses the resolved launch model, not the alias family, for effort and fast capability truth', () => {
    const source = createAnthropicSource({
      defaultLaunchModel: 'opus[1m]',
      models: [
        {
          id: 'opus[1m]',
          launchModel: 'opus[1m]',
          displayName: 'Opus 4.7 (1M)',
          hidden: true,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          inputModalities: ['text', 'image'],
          supportsFastMode: false,
          supportsPersonality: false,
          isDefault: true,
          upgrade: false,
          source: 'anthropic-models-api',
        },
        {
          id: 'claude-opus-4-6',
          launchModel: 'claude-opus-4-6',
          displayName: 'Opus 4.6',
          hidden: false,
          supportedReasoningEfforts: ['low', 'medium', 'high', 'max'],
          defaultReasoningEffort: 'medium',
          inputModalities: ['text', 'image'],
          supportsFastMode: true,
          supportsPersonality: false,
          isDefault: false,
          upgrade: false,
          source: 'anthropic-models-api',
        },
      ],
    });

    const aliasSelection = resolveAnthropicRuntimeSelection({
      source,
      selectedModel: 'opus',
      limitContext: false,
    });
    const explicit46Selection = resolveAnthropicRuntimeSelection({
      source,
      selectedModel: 'claude-opus-4-6',
      limitContext: false,
    });

    expect(aliasSelection.resolvedLaunchModel).toBe('opus[1m]');
    expect(aliasSelection.supportedEfforts).toEqual([]);
    expect(aliasSelection.supportsFastMode).toBe(false);

    expect(explicit46Selection.resolvedLaunchModel).toBe('claude-opus-4-6');
    expect(explicit46Selection.supportedEfforts).toEqual(['low', 'medium', 'high', 'max']);
    expect(explicit46Selection.defaultEffort).toBe('medium');
    expect(explicit46Selection.supportsFastMode).toBe(true);
  });

  it('resolves inherited fast mode from the provider default only when the exact model supports it', () => {
    const selection = resolveAnthropicRuntimeSelection({
      source: createAnthropicSource({
        models: [
          {
            id: 'claude-opus-4-6',
            launchModel: 'claude-opus-4-6',
            displayName: 'Opus 4.6',
            hidden: false,
            supportedReasoningEfforts: ['low', 'medium', 'high', 'max'],
            defaultReasoningEffort: 'medium',
            inputModalities: ['text', 'image'],
            supportsFastMode: true,
            supportsPersonality: false,
            isDefault: false,
            upgrade: false,
            source: 'anthropic-models-api',
          },
        ],
      }),
      selectedModel: 'claude-opus-4-6',
      limitContext: false,
    });

    expect(
      resolveAnthropicFastMode({
        selection,
        selectedFastMode: undefined,
        providerFastModeDefault: true,
      })
    ).toMatchObject({
      selectedFastMode: 'inherit',
      requestedFastMode: true,
      resolvedFastMode: true,
      selectable: true,
      disabledReason: null,
    });
  });

  it('resets only the invalid fast selection when an alias resolves to a non-fast model', () => {
    const selection = resolveAnthropicRuntimeSelection({
      source: createAnthropicSource({
        defaultLaunchModel: 'opus[1m]',
        models: [
          {
            id: 'opus[1m]',
            launchModel: 'opus[1m]',
            displayName: 'Opus 4.7 (1M)',
            hidden: true,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            inputModalities: ['text', 'image'],
            supportsFastMode: false,
            supportsPersonality: false,
            isDefault: true,
            upgrade: false,
            source: 'anthropic-models-api',
          },
        ],
      }),
      selectedModel: 'opus',
      limitContext: false,
    });

    expect(
      reconcileAnthropicRuntimeSelections({
        selection,
        selectedEffort: '',
        selectedFastMode: 'on',
        providerFastModeDefault: false,
      })
    ).toEqual({
      nextEffort: '',
      effortResetReason: null,
      nextFastMode: 'inherit',
      fastModeResetReason:
        'Fast mode is available only for Opus 4.6. Selected model resolves to Opus 4.7 (1M).',
    });
  });

  it('resets invalid max effort without mutating unrelated fast intent', () => {
    const selection = resolveAnthropicRuntimeSelection({
      source: createAnthropicSource({
        models: [
          {
            id: 'haiku',
            launchModel: 'haiku',
            displayName: 'Haiku 4.5',
            hidden: false,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            inputModalities: ['text', 'image'],
            supportsFastMode: false,
            supportsPersonality: false,
            isDefault: false,
            upgrade: false,
            source: 'anthropic-models-api',
          },
        ],
      }),
      selectedModel: 'haiku',
      limitContext: false,
    });

    expect(
      reconcileAnthropicRuntimeSelections({
        selection,
        selectedEffort: 'max',
        selectedFastMode: 'off',
        providerFastModeDefault: true,
      })
    ).toEqual({
      nextEffort: '',
      effortResetReason:
        'max effort is not available for the currently selected Anthropic model. Reset to Default.',
      nextFastMode: 'off',
      fastModeResetReason: null,
    });
  });

  it('does not reset explicit max or fast while runtime catalog truth is still unavailable', () => {
    const selection = resolveAnthropicRuntimeSelection({
      source: {
        modelCatalog: null,
        runtimeCapabilities: null,
      },
      selectedModel: 'claude-opus-4-6',
      limitContext: false,
    });

    expect(
      reconcileAnthropicRuntimeSelections({
        selection,
        selectedEffort: 'max',
        selectedFastMode: 'on',
        providerFastModeDefault: false,
      })
    ).toEqual({
      nextEffort: 'max',
      effortResetReason: null,
      nextFastMode: 'on',
      fastModeResetReason: null,
    });

    expect(
      resolveAnthropicFastMode({
        selection,
        selectedFastMode: 'on',
        providerFastModeDefault: false,
      }).disabledReason
    ).toBeTruthy(); // disabledReason is present (localized)
  });

  it('keeps the fast control visible in degraded states and surfaces the provider reason', () => {
    const selection = resolveAnthropicRuntimeSelection({
      source: createAnthropicSource({
        models: [
          {
            id: 'claude-opus-4-6',
            launchModel: 'claude-opus-4-6',
            displayName: 'Opus 4.6',
            hidden: false,
            supportedReasoningEfforts: ['low', 'medium', 'high', 'max'],
            defaultReasoningEffort: 'medium',
            inputModalities: ['text', 'image'],
            supportsFastMode: true,
            supportsPersonality: false,
            isDefault: false,
            upgrade: false,
            source: 'anthropic-models-api',
          },
        ],
        fastMode: {
          supported: true,
          available: false,
          reason: 'Fast mode status is degraded right now.',
          source: 'runtime',
        },
      }),
      selectedModel: 'claude-opus-4-6',
      limitContext: false,
    });

    expect(
      resolveAnthropicFastMode({
        selection,
        selectedFastMode: 'inherit',
        providerFastModeDefault: true,
      })
    ).toMatchObject({
      showFastModeControl: true,
      selectable: false,
      requestedFastMode: true,
      resolvedFastMode: false,
      disabledReason: 'Fast mode status is degraded right now.',
    });
  });
});
