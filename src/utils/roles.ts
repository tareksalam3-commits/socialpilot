import type { Profile } from '@/types/database';

/** True if this profile belongs to a platform Super Admin. */
export function isSuperAdmin(profile: Profile | null): boolean {
  return profile?.platform_role === 'super_admin';
}

/** Where to land a signed-in user right after login/register, based on role.
 * Super Admins go straight to their own panel; everyone else goes to the
 * regular workspace app. */
export function getPostLoginPath(profile: Profile | null): string {
  return isSuperAdmin(profile) ? '/admin' : '/app/assistant';
}

export type WorkspaceRole = 'owner' | 'manager' | 'member';

/** Owner and Manager can manage members, billing-adjacent settings, and
 * integrations for their workspace; Member is a contributor-only role. */
export function canManageWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export function isWorkspaceOwner(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner';
}
