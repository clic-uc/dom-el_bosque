import { headers } from 'next/headers';
import { cache } from 'react';
import { normalizeRole, type Role } from '@/shared/permissions';
import { ForbiddenError, PasswordChangeRequiredError, UnauthorizedError } from '../errors';
import { auth } from './index';

export type Actor = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  /** Rol tal como está en la BD (`null` = "Sin rol"). */
  rawRole: Role | null;
  mustChangePassword: boolean;
};

/** Lee la sesión real desde la BD (la cookie nunca es validación). Se memoiza por request. */
export const getOptionalActor = cache(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string | null; mustChangePassword?: boolean };
  const rawRole = u.role === 'admin' || u.role === 'editor' || u.role === 'viewer' ? u.role : null;
  return {
    userId: u.id,
    email: u.email,
    name: u.name,
    role: normalizeRole(u.role),
    rawRole,
    mustChangePassword: !!u.mustChangePassword,
  };
});

export type GetActorOptions = {
  /** Permitir aunque el usuario deba cambiar su contraseña temporal (solo para esa pantalla). */
  allowPasswordChangeRequired?: boolean;
};

/** Lanza `Unauthorized` si no hay sesión; `PasswordChangeRequired` si tiene contraseña temporal (§6.1). */
export async function getActor(opts: GetActorOptions = {}): Promise<Actor> {
  const actor = await getOptionalActor();
  if (!actor) throw new UnauthorizedError();
  if (actor.mustChangePassword && !opts.allowPasswordChangeRequired) throw new PasswordChangeRequiredError();
  return actor;
}

/** Lanza `Forbidden` si el rol del usuario no está entre los permitidos. */
export async function requireRole(...allowed: Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!allowed.includes(actor.role)) throw new ForbiddenError();
  return actor;
}

export function assertRole(actor: Actor, ...allowed: Role[]): void {
  if (!allowed.includes(actor.role)) throw new ForbiddenError();
}
