/**
 * Team lead identity rules.
 *
 * Internal storage uses one canonical member name: "team-lead".
 * Runtime/legacy data may still contain "lead"; treat it as an alias only.
 * UI should display this member as "负责人" instead of leaking either id.
 */

export const CANONICAL_LEAD_MEMBER_NAME = 'team-lead';
export const LEGACY_LEAD_MEMBER_NAME = 'lead';
export const LEAD_DISPLAY_NAME = '负责人';

const LEAD_MEMBER_NAME_ALIASES = new Set([CANONICAL_LEAD_MEMBER_NAME, LEGACY_LEAD_MEMBER_NAME]);
const LEAD_AGENT_TYPES = new Set([
  CANONICAL_LEAD_MEMBER_NAME,
  LEGACY_LEAD_MEMBER_NAME,
  'orchestrator',
]);

function normalizeLeadIdentity(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? '';
}

export function isLeadMemberName(name: string | undefined | null): boolean {
  return LEAD_MEMBER_NAME_ALIASES.has(normalizeLeadIdentity(name));
}

export function resolveLeadMemberName(name: string | undefined | null): string {
  return isLeadMemberName(name) ? CANONICAL_LEAD_MEMBER_NAME : (name?.trim() ?? '');
}

/**
 * Returns true if the given agentType string identifies a team lead.
 * Handles the canonical app value plus runtime labels.
 *
 * Does NOT match "general-purpose" — that value is ambiguous and used
 * for regular teammates too. Lead detection for "general-purpose" agents
 * must rely on name-based checks (see {@link isLeadMember}).
 */
export function isLeadAgentType(agentType: string | undefined | null): boolean {
  return LEAD_AGENT_TYPES.has(normalizeLeadIdentity(agentType));
}

/**
 * Returns true if the member is a team lead, checking both agentType
 * and the canonical internal lead name as a fallback.
 */
export function isLeadMember(member: { agentType?: unknown; name?: unknown }): boolean {
  const agentType = typeof member.agentType === 'string' ? member.agentType : null;
  if (isLeadAgentType(agentType)) return true;
  const name = typeof member.name === 'string' ? member.name : null;
  return isLeadMemberName(name);
}
