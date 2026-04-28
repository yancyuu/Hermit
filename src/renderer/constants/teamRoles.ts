/** Preset role options shown in role selectors (Add Member, Create Team, Role Editor). */
export const PRESET_ROLES = [
  'architect',
  'reviewer',
  'developer',
  'qa',
  'researcher',
  'docs',
  'auditor',
  'optimizer',
] as const;

/** Sentinel value for "custom role" in select dropdowns. */
export const CUSTOM_ROLE = '__custom__';

/** Sentinel value for "no role" in select dropdowns. */
export const NO_ROLE = '__none__';

/** Roles that cannot be assigned manually (reserved for system use). */
export const FORBIDDEN_ROLES = new Set(['lead', 'team-lead', 'orchestrator']);

export const ROLE_LABELS: Record<string, string> = {
  architect: '架构师',
  reviewer: '评审',
  developer: '开发',
  qa: '测试',
  researcher: '研究',
  docs: '文档',
  auditor: '审计',
  optimizer: '优化',
  lead: '负责人',
  'team-lead': '团队负责人',
  orchestrator: '编排者',
  'general-purpose': '通用成员',
};

export function getRoleLabel(role: string | undefined): string | null {
  if (!role) {
    return null;
  }
  return ROLE_LABELS[role] ?? null;
}
