import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';
import type { UserRole } from './constants';

/** Control de acceso de Better Auth (§6.1). Solo el admin tiene permisos sobre usuarios/sesiones. */
const statement = { ...defaultStatements } as const;

export const ac = createAccessControl(statement);

export const roles = {
  admin: ac.newRole({ ...adminAc.statements }),
  editor: ac.newRole({ user: [], session: [] }),
  viewer: ac.newRole({ user: [], session: [] }),
};

export type Role = UserRole;

/** Acciones de la app (§6.2). La autorización real siempre ocurre en el servidor; `can()` solo oculta controles. */
export const appActions = [
  'view',
  'export',
  'layers.write',
  'records.write',
  'records.assignNumber',
  'records.correctNumber',
  'records.deleteNumbered',
  'attachments.write',
  'roles.write',
  'roleOperations.delete',
  'imports.write',
  'imports.revertAll',
  'audit.viewAll',
  'roles.importPadron',
  'users.manage',
] as const;
export type AppAction = (typeof appActions)[number];

const matrix: Record<AppAction, readonly Role[]> = {
  view: ['viewer', 'editor', 'admin'],
  export: ['viewer', 'editor', 'admin'],
  'layers.write': ['editor', 'admin'],
  'records.write': ['editor', 'admin'],
  'records.assignNumber': ['editor', 'admin'],
  'records.correctNumber': ['admin'],
  'records.deleteNumbered': ['admin'],
  'attachments.write': ['editor', 'admin'],
  'roles.write': ['editor', 'admin'],
  'roleOperations.delete': ['admin'],
  'imports.write': ['editor', 'admin'],
  'imports.revertAll': ['admin'],
  'audit.viewAll': ['admin'],
  'roles.importPadron': ['admin'],
  'users.manage': ['admin'],
};

/** `role` null/undefined = "Sin rol", que se comporta como `viewer`. */
export function can(role: Role | null | undefined, action: AppAction): boolean {
  return matrix[action].includes(role ?? 'viewer');
}

export function rolesFor(action: AppAction): readonly Role[] {
  return matrix[action];
}

export function normalizeRole(role: string | null | undefined): Role {
  return role === 'admin' || role === 'editor' || role === 'viewer' ? role : 'viewer';
}
