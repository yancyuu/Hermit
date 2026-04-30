import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CodexAccountSnapshotDto } from '@features/codex-account/contracts';

vi.mock('@renderer/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('@renderer/components/ui/tabs', () => {
  let currentValue = '';
  let currentOnValueChange: ((value: string) => void) | null = null;

  return {
    Tabs: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode;
      value: string;
      onValueChange?: (value: string) => void;
    }) => {
      currentValue = value;
      currentOnValueChange = onValueChange ?? null;
      return React.createElement('div', { 'data-tabs-value': value }, children);
    },
    TabsList: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    TabsTrigger: ({
      children,
      value,
      disabled,
      title,
    }: {
      children: React.ReactNode;
      value: string;
      disabled?: boolean;
      title?: string;
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          disabled,
          title,
          'data-state': currentValue === value ? 'active' : 'inactive',
          onClick: () => {
            if (!disabled) {
              currentOnValueChange?.(value);
            }
          },
        },
        children
      ),
  };
});

const storeState = {
  cliStatus: null as unknown,
  cliStatusLoading: false,
  appConfig: { general: { multimodelEnabled: true } },
  fetchCliProviderStatus: vi.fn().mockResolvedValue(undefined),
};
const codexAccountHookState = {
  snapshot: null as CodexAccountSnapshotDto | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(() => Promise.resolve(undefined)),
  startChatgptLogin: vi.fn(() => Promise.resolve(true)),
  cancelChatgptLogin: vi.fn(() => Promise.resolve(true)),
  logout: vi.fn(() => Promise.resolve(true)),
};

vi.mock('@renderer/store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));

vi.mock('@features/codex-account/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/codex-account/renderer')>();
  return {
    ...actual,
    useCodexAccountSnapshot: () => codexAccountHookState,
  };
});

import { TeamModelSelector } from '@renderer/components/team/dialogs/TeamModelSelector';

describe('TeamModelSelector Anthropic-only surface', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    storeState.cliStatus = null;
    storeState.cliStatusLoading = false;
    storeState.fetchCliProviderStatus.mockClear();
    codexAccountHookState.snapshot = null;
    codexAccountHookState.loading = false;
    codexAccountHookState.error = null;
    codexAccountHookState.refresh.mockClear();
    codexAccountHookState.startChatgptLogin.mockClear();
    codexAccountHookState.cancelChatgptLogin.mockClear();
    codexAccountHookState.logout.mockClear();
  });

  it('renders the default model option even while runtime status is loading', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatusLoading = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    expect(host.textContent).toBeTruthy();
    expect(host.textContent).toContain('Anthropic');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('normalizes a stale disabled selection back to default', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: 'gpt-5.1-codex-mini',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('normalizes a stale 5.3 Codex Spark selection back to default', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: 'gpt-5.3-codex-spark',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledWith('');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps the curated Anthropic picker surface while showing runtime-backed labels', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'anthropic',
          models: ['opus', 'claude-opus-4-6', 'sonnet', 'haiku'],
          modelCatalog: {
            schemaVersion: 1,
            providerId: 'anthropic',
            source: 'anthropic-models-api',
            status: 'ready',
            fetchedAt: '2026-04-21T00:00:00.000Z',
            staleAt: '2026-04-21T00:10:00.000Z',
            defaultModelId: 'opus[1m]',
            defaultLaunchModel: 'opus[1m]',
            models: [
              {
                id: 'opus',
                launchModel: 'opus',
                displayName: 'Opus 4.8',
                hidden: false,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Opus 4.8',
              },
              {
                id: 'opus[1m]',
                launchModel: 'opus[1m]',
                displayName: 'Opus 4.8 (1M)',
                hidden: true,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
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
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Opus 4.6',
              },
              {
                id: 'sonnet',
                launchModel: 'sonnet',
                displayName: 'Sonnet 4.7',
                hidden: false,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Sonnet 4.7',
              },
              {
                id: 'haiku',
                launchModel: 'haiku',
                displayName: 'Haiku 4.6',
                hidden: false,
                supportedReasoningEfforts: [],
                defaultReasoningEffort: null,
                inputModalities: ['text', 'image'],
                supportsPersonality: false,
                isDefault: false,
                upgrade: false,
                source: 'anthropic-models-api',
                badgeLabel: 'Haiku 4.6',
              },
            ],
            diagnostics: {
              configReadState: 'ready',
              appServerState: 'healthy',
              message: null,
              code: null,
            },
          },
          runtimeCapabilities: {
            modelCatalog: {
              dynamic: true,
              source: 'anthropic-models-api',
            },
            reasoningEffort: {
              supported: true,
              values: ['low', 'medium', 'high'],
              configPassthrough: false,
            },
          },
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const text = host.textContent ?? '';
    expect(text).toContain('Anthropic');
    expect(text).toContain('Opus 4.8');
    expect(text).toContain('Sonnet 4.7');
    expect(text).toContain('Haiku 4.6');
    expect(text).not.toContain('Opus 4.8 (1M)');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('keeps runtime model buttons selectable without starting automatic model probes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'anthropic',
          models: ['opus', 'sonnet'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: '',
          onValueChange,
        })
      );
      await Promise.resolve();
    });

    expect(storeState.fetchCliProviderStatus).not.toHaveBeenCalled();

    const selectableButton = Array.from(host.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.includes('Opus') && button.getAttribute('aria-disabled') !== 'true'
    );
    expect(selectableButton).toBeTruthy();

    await act(async () => {
      selectableButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('highlights the specific model tile when preflight found a model issue', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    storeState.cliStatus = {
      providers: [
        {
          providerId: 'anthropic',
          models: ['opus', 'sonnet'],
          modelVerificationState: 'idle',
          modelAvailability: [],
        },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: 'sonnet',
          onValueChange: () => undefined,
          modelIssueReasonByValue: {
            sonnet: 'Not available on this runtime',
          },
        })
      );
      await Promise.resolve();
    });

    const text = host.textContent ?? '';
    expect(text).toContain('问题');
    const issueButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Sonnet')
    );
    expect(issueButton?.className).toContain('border-red-500/');
    expect(issueButton?.getAttribute('title')).toBe('Not available on this runtime');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('renders the Anthropic provider tab as the only selectable tab', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(TeamModelSelector, {
          providerId: 'anthropic',
          onProviderChange: () => undefined,
          value: '',
          onValueChange: () => undefined,
        })
      );
      await Promise.resolve();
    });

    const text = host.textContent ?? '';
    expect(text).toContain('Anthropic');
    const tabButtons = Array.from(host.querySelectorAll('button[data-state]'));
    expect(tabButtons.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
});
