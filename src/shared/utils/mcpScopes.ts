import type { CliFlavor } from '@shared/types';
import type { InstalledMcpEntry } from '@shared/types/extensions';

export type McpInstalledScope = InstalledMcpEntry['scope'];
export type McpSharedScope = Extract<McpInstalledScope, 'user' | 'global'>;

export function getDefaultMcpSharedScope(flavor?: CliFlavor | null): McpSharedScope {
  return flavor === 'agent_teams_orchestrator' ? 'global' : 'user';
}

export function isSharedMcpScope(scope?: string): scope is McpSharedScope {
  return scope === 'user' || scope === 'global';
}

export function isProjectScopedMcpScope(scope?: string): scope is 'project' | 'local' {
  return scope === 'project' || scope === 'local';
}

export function isInstalledMcpScope(scope: unknown): scope is McpInstalledScope {
  return scope === 'user' || scope === 'global' || scope === 'project' || scope === 'local';
}

export function getMcpScopeLabel(scope: McpInstalledScope, flavor?: CliFlavor | null): string {
  switch (scope) {
    case 'global':
      return '全局';
    case 'user':
      return flavor === 'agent_teams_orchestrator' ? '用户（旧版）' : '用户（全局）';
    case 'project':
      return '项目';
    case 'local':
      return '本地';
    default:
      return scope;
  }
}
