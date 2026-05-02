import { describe, expect, it } from 'vitest';

import { getVisibleTeamProviderModels, normalizeTeamModelForUi } from '@renderer/utils/teamModelCatalog';

describe('teamModelCatalog', () => {
  it('filters UI-disabled Codex models from provider badge lists', () => {
    expect(
      getVisibleTeamProviderModels('codex', [
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.1-codex-mini',
        'gpt-5.1-codex-max',
      ])
    ).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2',
      'gpt-5.1-codex-max',
    ]);
  });

  it('keeps only the three Anthropic team aliases visible', () => {
    expect(
      getVisibleTeamProviderModels('anthropic', [
        'claude-haiku-4-5-20251001',
        'claude-opus-4-6',
        'claude-opus-4-6[1m]',
        'claude-sonnet-4-6',
        'claude-sonnet-4-6[1m]',
      ])
    ).toEqual(['haiku', 'opus', 'sonnet']);
  });

  it('normalizes legacy Anthropic model ids to the three team aliases', () => {
    expect(normalizeTeamModelForUi('anthropic', 'claude-opus-4-6')).toBe('opus');
    expect(normalizeTeamModelForUi('anthropic', 'claude-opus-4-6[1m]')).toBe('opus');
    expect(normalizeTeamModelForUi('anthropic', 'claude-sonnet-4-6')).toBe('sonnet');
    expect(normalizeTeamModelForUi('anthropic', 'claude-haiku-4-5-20251001')).toBe('haiku');
  });
});
