import { describe, expect, it } from 'vitest';

import {
  filterMainScreenCliProviders,
  normalizeCreateLaunchProviderForUi,
} from '@renderer/utils/claudeCodeOnlyProviders';

describe('claudeCodeOnlyProviders', () => {
  it('shows only Anthropic on provider status surfaces', () => {
    expect(
      filterMainScreenCliProviders([
        { providerId: 'anthropic', label: 'Anthropic' },
        { providerId: 'codex', label: 'Codex' },
        { providerId: 'gemini', label: 'Gemini' },
        { providerId: 'opencode', label: 'OpenCode' },
      ])
    ).toEqual([{ providerId: 'anthropic', label: 'Anthropic' }]);
  });

  it('normalizes all create and launch provider values to Anthropic', () => {
    expect(normalizeCreateLaunchProviderForUi('anthropic', true)).toBe('anthropic');
    expect(normalizeCreateLaunchProviderForUi('codex', true)).toBe('anthropic');
    expect(normalizeCreateLaunchProviderForUi('gemini', true)).toBe('anthropic');
    expect(normalizeCreateLaunchProviderForUi('opencode', true)).toBe('anthropic');
  });
});
