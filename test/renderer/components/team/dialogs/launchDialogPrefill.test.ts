import { describe, expect, it } from 'vitest';

import { resolveLaunchDialogPrefill } from '@renderer/components/team/dialogs/launchDialogPrefill';

import type { ResolvedTeamMember, TeamCreateRequest, TeamProviderId } from '@shared/types';

function createStoredModelGetter(models: Partial<Record<TeamProviderId, string>>) {
  return (providerId: TeamProviderId): string => models[providerId] ?? '';
}

describe('resolveLaunchDialogPrefill', () => {
  it('falls back current lead runtime to the launch UI provider before localStorage defaults', () => {
    const members = [
      {
        name: 'lead',
        agentType: 'lead',
        providerId: 'codex',
        model: 'gpt-5.4',
        effort: 'medium',
      },
      {
        name: 'alice',
        agentType: 'reviewer',
        providerId: 'codex',
        model: 'gpt-5.4-mini',
        effort: 'medium',
      },
    ] as ResolvedTeamMember[];

    const result = resolveLaunchDialogPrefill({
      members,
      savedRequest: null,
      previousLaunchParams: {
        providerId: 'codex',
        model: 'gpt-5.4',
        effort: 'medium',
      },
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'gpt-5.4',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('prefers current lead model over a stale saved request while using launch UI provider', () => {
    const members = [
      {
        name: 'lead',
        agentType: 'lead',
        providerId: 'codex',
        model: 'gpt-5.4',
        effort: 'medium',
      },
    ] as ResolvedTeamMember[];

    const savedRequest = {
      teamName: 'vector-room-2',
      cwd: '/Users/test/project',
      providerId: 'anthropic',
      model: 'haiku',
      effort: 'low',
      members: [],
    } as TeamCreateRequest;

    const result = resolveLaunchDialogPrefill({
      members,
      savedRequest,
      previousLaunchParams: undefined,
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'gpt-5.4',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('falls back to previous launch params when the current team snapshot is unavailable', () => {
    const result = resolveLaunchDialogPrefill({
      members: [],
      savedRequest: null,
      previousLaunchParams: {
        providerId: 'codex',
        providerBackendId: 'codex-native',
        model: 'gpt-5.3-codex',
        effort: 'high',
      },
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: 'codex-native',
      model: 'gpt-5.3-codex',
      effort: 'high',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('keeps saved request backend lane metadata when provider falls back to launch UI default', () => {
    const result = resolveLaunchDialogPrefill({
      members: [],
      savedRequest: {
        teamName: 'vector-room-2',
        cwd: '/Users/test/project',
        providerId: 'codex',
        providerBackendId: 'codex-native',
        model: 'gpt-5.4',
        effort: 'medium',
        members: [],
      } as TeamCreateRequest,
      previousLaunchParams: undefined,
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: 'codex-native',
      model: 'gpt-5.4',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('falls back new Codex launch flows to the launch UI provider', () => {
    const result = resolveLaunchDialogPrefill({
      members: [
        {
          name: 'lead',
          agentType: 'lead',
          providerId: 'codex',
          model: 'gpt-5.4',
          effort: 'medium',
        },
      ] as ResolvedTeamMember[],
      savedRequest: null,
      previousLaunchParams: undefined,
      multimodelEnabled: true,
      storedProviderId: 'codex',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'gpt-5.4',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('does not carry a frozen Gemini model into an Anthropic fallback', () => {
    const members = [
      {
        name: 'lead',
        agentType: 'lead',
        providerId: 'gemini',
        model: 'gemini-2.5-flash-lite',
        effort: 'medium',
      },
    ] as ResolvedTeamMember[];

    const result = resolveLaunchDialogPrefill({
      members,
      savedRequest: null,
      previousLaunchParams: undefined,
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'haiku',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('falls back previous OpenCode relaunch runtime to the launch UI provider', () => {
    const result = resolveLaunchDialogPrefill({
      members: [],
      savedRequest: null,
      previousLaunchParams: {
        providerId: 'opencode',
        model: 'openrouter/moonshotai/kimi-k2',
        effort: 'medium',
      },
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        opencode: 'openai/gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'openrouter/moonshotai/kimi-k2',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('prefers per-team launch params for limitContext over stale global storage', () => {
    const result = resolveLaunchDialogPrefill({
      members: [],
      savedRequest: null,
      previousLaunchParams: {
        providerId: 'anthropic',
        model: 'opus[1m][1m]',
        effort: 'high',
        limitContext: true,
      },
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'opus',
      effort: 'high',
      fastMode: 'inherit',
      limitContext: true,
    });
  });

  it('falls back to anthropic when previous provider is not available in launch UI', () => {
    const result = resolveLaunchDialogPrefill({
      members: [],
      savedRequest: null,
      previousLaunchParams: {
        providerId: 'codex',
        model: 'custom-model[1m]',
        effort: 'medium',
      },
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'custom-model',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });

  it('uses anthropic base model when a scoped non-anthropic previous model is unavailable', () => {
    const result = resolveLaunchDialogPrefill({
      members: [],
      savedRequest: null,
      previousLaunchParams: {
        providerId: 'codex',
        model: 'custom-model[1m]',
        effort: 'medium',
      },
      multimodelEnabled: true,
      storedProviderId: 'anthropic',
      storedEffort: 'medium',
      storedFastMode: 'inherit',
      storedLimitContext: false,
      getStoredModel: createStoredModelGetter({
        anthropic: 'haiku',
        codex: 'gpt-5.4',
      }),
    });

    expect(result).toEqual({
      providerId: 'anthropic',
      providerBackendId: undefined,
      model: 'custom-model',
      effort: 'medium',
      fastMode: 'inherit',
      limitContext: false,
    });
  });
});
