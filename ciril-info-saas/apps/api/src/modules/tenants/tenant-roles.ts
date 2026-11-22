/** Tenant role hierarchy. A member can only manage people strictly below them. */
export const TENANT_ROLE_RANK: Record<string, number> = {
  TENANT_OWNER: 3,
  TENANT_ADMIN: 2,
  CUSTOMER: 1,
};

/** Roles that can be granted by invitation or role change (ownership is never granted this way). */
export const ASSIGNABLE_TENANT_ROLES = ['TENANT_ADMIN', 'CUSTOMER'] as const;
export type AssignableTenantRole = (typeof ASSIGNABLE_TENANT_ROLES)[number];

export const rank = (key: string) => TENANT_ROLE_RANK[key] ?? 0;

/** May `actorRole` give `newRole` to someone whose current role is `targetRole` (or a new invitee)? */
export function canAssign(actorRole: string, newRole: string, targetRole?: string): boolean {
  if (!ASSIGNABLE_TENANT_ROLES.includes(newRole as AssignableTenantRole)) return false;
  if (rank(newRole) > rank(actorRole)) return false;
  if (targetRole !== undefined && rank(targetRole) >= rank(actorRole)) return false;
  return true;
}

/** May `actorRole` remove someone with `targetRole`? (Leaving yourself is handled separately.) */
export const canRemove = (actorRole: string, targetRole: string) => rank(targetRole) < rank(actorRole);
