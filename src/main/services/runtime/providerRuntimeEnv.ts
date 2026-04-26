import { ConfigManager } from '../infrastructure/ConfigManager';

import type { CliProviderId, TeamProviderId } from '@shared/types';

type RuntimeEnvProviderId = CliProviderId | TeamProviderId;

const PROVIDER_ROUTING_ENV_KEYS = [
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_ENTRY_PROVIDER',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GEMINI',
] as const;

const BACKEND_SELECTION_ENV_KEYS = [
  'CLAUDE_CODE_GEMINI_BACKEND',
  'CLAUDE_CODE_CODEX_BACKEND',
] as const;

export function applyConfiguredRuntimeBackendsEnv(
  env: NodeJS.ProcessEnv,
  runtimeConfig = ConfigManager.getInstance().getConfig().runtime
): NodeJS.ProcessEnv {
  for (const key of BACKEND_SELECTION_ENV_KEYS) {
    env[key] = undefined;
  }

  env.CLAUDE_CODE_GEMINI_BACKEND = runtimeConfig.providerBackends.gemini;
  env.CLAUDE_CODE_CODEX_BACKEND = runtimeConfig.providerBackends.codex;
  return env;
}

export function applyProviderRuntimeEnv(
  env: NodeJS.ProcessEnv,
  providerId: RuntimeEnvProviderId | undefined
): NodeJS.ProcessEnv {
  const resolvedProvider = resolveRuntimeProviderId(providerId);

  for (const key of PROVIDER_ROUTING_ENV_KEYS) {
    env[key] = undefined;
  }

  // Anthropic uses the native Claude Code auth/proxy path; do not host-route it.
  if (resolvedProvider === 'anthropic') {
    return env;
  }

  // Non-Anthropic provider overrides must be positive pins.
  env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1';
  env.CLAUDE_CODE_ENTRY_PROVIDER = resolvedProvider;

  return env;
}

export function resolveRuntimeProviderId(
  providerId: RuntimeEnvProviderId | undefined
): CliProviderId {
  if (providerId === 'codex' || providerId === 'gemini' || providerId === 'opencode') {
    return providerId;
  }

  return 'anthropic';
}

export function resolveTeamProviderId(providerId: TeamProviderId | undefined): TeamProviderId {
  return providerId === 'codex' || providerId === 'gemini' || providerId === 'opencode'
    ? providerId
    : 'anthropic';
}
