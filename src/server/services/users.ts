import { asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { users } from '@/db/schema';
import type { UserRole } from '@/shared/constants';
import type { CreateUserInput, UsersQuery } from '@/shared/schemas/users';
import type { UserItem, UsersList } from '@/shared/types';
import { auth } from '../auth';
import type { Actor } from '../auth/session';
import { ConflictError, NotFoundError } from '../errors';
import { escapeLike } from './_shared';
import * as audit from './audit';

/**
 * Gestión de usuarios (§7.8): lectura con Drizzle, escritura a través de Better Auth.
 *
 * Better Auth 1.7: `auth.api.createUser` funciona en servidor sin sesión; `setRole`, `setUserPassword`,
 * `removeUser` y `revokeUserSessions` exigen los `headers` de una sesión admin (los Route Handlers pasan
 * `req.headers`, que trae la cookie de sesión).
 */

type UserRow = typeof users.$inferSelect;

function toRole(role: string | null | undefined): UserRole | null {
  return role === 'admin' || role === 'editor' || role === 'viewer' ? role : null;
}

function toUserItem(row: Pick<UserRow, 'id' | 'name' | 'email' | 'role' | 'mustChangePassword' | 'createdAt'>, lastSignInAt: Date | null): UserItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: toRole(row.role),
    lastSignInAt: lastSignInAt ? new Date(lastSignInAt).toISOString() : null,
    mustChangePassword: row.mustChangePassword,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Error de Better Auth (`APIError`): trae `status` y `body.{code,message}`. */
type AuthApiError = { status: string | number; body?: { code?: string; message?: string } };

function isAuthApiError(err: unknown): err is AuthApiError {
  return typeof err === 'object' && err !== null && 'status' in err && 'body' in err;
}

/** Traduce los errores conocidos de Better Auth a errores de dominio con mensaje en español. */
function translateAuthError(err: unknown, email?: string): never {
  if (isAuthApiError(err)) {
    const code = err.body?.code ?? '';
    if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || code === 'USER_ALREADY_EXISTS') {
      throw new ConflictError(`Ya existe un usuario con el correo ${email ?? 'indicado'}. Usa otro correo o busca al usuario en la lista.`);
    }
    if (code === 'USER_NOT_FOUND') throw new NotFoundError('El usuario no existe o ya fue eliminado');
    if (code === 'YOU_CANNOT_REMOVE_YOURSELF') throw new ConflictError('No puedes eliminar tu propia cuenta');
    if (code === 'PASSWORD_TOO_SHORT') throw new ConflictError('La contraseña debe tener al menos 10 caracteres');
  }
  throw err;
}

// Subconsulta con alias explícito: en un select de una sola tabla Drizzle no califica las columnas
// y `"user_id" = "id"` resolvería `id` contra `sessions`.
const lastSignInSql = sql<Date | null>`(SELECT max(s.created_at) FROM sessions s WHERE s.user_id = users.id)`;

export async function listUsers(db: DbOrTx, q: UsersQuery): Promise<UsersList> {
  let where: SQL | undefined;
  if (q.query) {
    const like = `%${escapeLike(q.query)}%`;
    where = or(ilike(users.name, like), ilike(users.email, like));
  }

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        mustChangePassword: users.mustChangePassword,
        createdAt: users.createdAt,
        lastSignInAt: lastSignInSql,
      })
      .from(users)
      .where(where)
      .orderBy(asc(users.name), asc(users.email))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return {
    data: rows.map((r) => toUserItem(r, r.lastSignInAt)),
    total: Number(totals[0]?.total ?? 0),
  };
}

async function requireUser(db: DbOrTx, id: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new NotFoundError('El usuario no existe o ya fue eliminado');
  return row;
}

async function getUserItem(db: DbOrTx, id: string): Promise<UserItem> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
      lastSignInAt: lastSignInSql,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row) throw new NotFoundError('El usuario no existe o ya fue eliminado');
  return toUserItem(row, row.lastSignInAt);
}

/** Crea la cuenta con contraseña temporal: el usuario deberá cambiarla al ingresar (§6.1). */
export async function createUser(db: DbOrTx, actor: Actor, input: CreateUserInput): Promise<UserItem> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    throw new ConflictError(`Ya existe un usuario con el correo ${email}. Usa otro correo o busca al usuario en la lista.`);
  }

  let createdId: string;
  try {
    const res = await auth.api.createUser({
      body: {
        email,
        password: input.password,
        name: input.name,
        role: input.role,
        data: { mustChangePassword: true },
      },
    });
    createdId = res.user.id;
  } catch (err) {
    translateAuthError(err, email);
  }

  // Garantiza el cambio obligatorio aunque el adaptador ignore el campo adicional.
  await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, createdId));

  await audit.log(db, {
    actor,
    action: 'CREATE',
    entityType: 'USER',
    entityId: createdId,
    metadata: { email, name: input.name, role: input.role },
  });

  return getUserItem(db, createdId);
}

/**
 * Cambia o quita el rol. Con rol usa `auth.api.setRole`; con `null` actualiza directo (el plugin no permite quitarlo).
 * Un administrador no puede quitarse ni cambiarse su propio rol de administrador (§7.8).
 */
export async function setUserRole(
  db: DbOrTx,
  headers: Headers,
  actor: Actor,
  id: string,
  role: UserRole | null,
): Promise<{ role: UserRole | null }> {
  const target = await requireUser(db, id);
  const before = toRole(target.role);

  if (id === actor.userId && role !== 'admin') {
    throw new ConflictError(
      'No puedes quitarte ni cambiarte tu propio rol de administrador. Pide a otro administrador que lo haga.',
    );
  }
  if (before === role) return { role };

  if (role === null) {
    await db.update(users).set({ role: null }).where(eq(users.id, id));
  } else {
    try {
      await auth.api.setRole({ body: { userId: id, role }, headers });
    } catch (err) {
      translateAuthError(err);
    }
  }

  await audit.log(db, {
    actor,
    action: 'UPDATE',
    entityType: 'USER',
    entityId: id,
    metadata: { email: target.email, before: { role: before }, after: { role } },
  });

  return { role };
}

/**
 * Asigna una contraseña temporal: la fija, marca el cambio obligatorio y cierra todas las sesiones del usuario.
 * Nunca se guarda la contraseña en la auditoría.
 */
export async function setUserPassword(db: DbOrTx, headers: Headers, actor: Actor, id: string, password: string): Promise<void> {
  const target = await requireUser(db, id);
  if (id === actor.userId) {
    throw new ConflictError('Para cambiar tu propia contraseña usa "Mi cuenta" en el menú de usuario.');
  }

  try {
    await auth.api.setUserPassword({ body: { userId: id, newPassword: password }, headers });
  } catch (err) {
    translateAuthError(err);
  }

  await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, id));

  try {
    await auth.api.revokeUserSessions({ body: { userId: id }, headers });
  } catch (err) {
    translateAuthError(err);
  }

  await audit.log(db, {
    actor,
    action: 'UPDATE',
    entityType: 'USER',
    entityId: id,
    metadata: { email: target.email, temporaryPassword: true, sessionsRevoked: true },
  });
}

/** Elimina la cuenta (sesiones y credenciales incluidas). `records.created_by` y `audit_logs` conservan el id. */
export async function deleteUser(db: DbOrTx, headers: Headers, actor: Actor, id: string): Promise<void> {
  if (id === actor.userId) {
    throw new ConflictError('No puedes eliminar tu propia cuenta. Pide a otro administrador que lo haga.');
  }
  const target = await requireUser(db, id);

  try {
    await auth.api.removeUser({ body: { userId: id }, headers });
  } catch (err) {
    translateAuthError(err);
  }

  await audit.log(db, {
    actor,
    action: 'DELETE',
    entityType: 'USER',
    entityId: id,
    metadata: { email: target.email, name: target.name, role: toRole(target.role) },
  });
}
