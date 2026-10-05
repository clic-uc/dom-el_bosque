import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sqlClient } from '@/db/client';
import { auditLogs, sessions, users } from '@/db/schema';
import { auth } from '../auth';
import type { Actor } from '../auth/session';
import { ConflictError, NotFoundError } from '../errors';
import * as usersService from './users';

/**
 * Tests con BD real (DATABASE_URL de sigdom_test_d). Los endpoints admin de Better Auth exigen headers
 * con la cookie de una sesión admin: iniciamos sesión con `auth.api.signInEmail({ returnHeaders: true })`
 * y construimos el header `cookie` a partir del `set-cookie` devuelto.
 */

const ADMIN = { email: 'admin@test.cl', name: 'Admin DOM', password: 'ClaveAdmin-2026' };

function actorFor(id: string, email: string, role: Actor['role'] = 'admin'): Actor {
  return { userId: id, email, name: 'Test', role, rawRole: role, mustChangePassword: false };
}

async function createDirect(email: string, name: string, role: 'admin' | 'editor' | 'viewer', password = 'ClaveTemporal-2026') {
  const res = await auth.api.createUser({ body: { email, name, password, role, data: { mustChangePassword: false } } });
  return res.user;
}

/** Headers con la cookie de sesión de un usuario, como las que llegan a un Route Handler. */
async function sessionHeaders(email: string, password: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const setCookies = headers.getSetCookie();
  expect(setCookies.length).toBeGreaterThan(0);
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  return new Headers({ cookie });
}

describe('users.service', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, sessions, accounts, verifications, audit_logs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  it('listUsers busca por nombre/correo e informa el último acceso', async () => {
    const admin = await createDirect(ADMIN.email, ADMIN.name, 'admin', ADMIN.password);
    await createDirect('maria@test.cl', 'María Pérez', 'editor');
    await createDirect('juan@test.cl', 'Juan Soto', 'viewer');

    const all = await usersService.listUsers(db, { limit: 20, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.data.map((u) => u.email)).toEqual(['admin@test.cl', 'juan@test.cl', 'maria@test.cl']);
    expect(all.data.every((u) => u.lastSignInAt === null)).toBe(true);

    await sessionHeaders(ADMIN.email, ADMIN.password);
    const afterLogin = await usersService.listUsers(db, { limit: 20, offset: 0, query: 'admin' });
    expect(afterLogin.total).toBe(1);
    expect(afterLogin.data[0]?.id).toBe(admin.id);
    expect(afterLogin.data[0]?.lastSignInAt).not.toBeNull();

    const byName = await usersService.listUsers(db, { limit: 20, offset: 0, query: 'pérez' });
    expect(byName.data.map((u) => u.email)).toEqual(['maria@test.cl']);

    const paged = await usersService.listUsers(db, { limit: 2, offset: 2 });
    expect(paged.total).toBe(3);
    expect(paged.data).toHaveLength(1);
  });

  it('createUser deja la contraseña como temporal y audita sin guardar la contraseña', async () => {
    const admin = await createDirect(ADMIN.email, ADMIN.name, 'admin', ADMIN.password);
    const actor = actorFor(admin.id, admin.email);

    const created = await usersService.createUser(db, actor, {
      name: 'Nueva Funcionaria',
      email: 'Nueva@Test.cl',
      password: 'Temporal-12345',
      role: 'editor',
    });
    expect(created.email).toBe('nueva@test.cl');
    expect(created.role).toBe('editor');
    expect(created.mustChangePassword).toBe(true);

    const [row] = await db.select().from(users).where(eq(users.id, created.id));
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.role).toBe('editor');

    // puede iniciar sesión con la contraseña temporal
    await expect(sessionHeaders('nueva@test.cl', 'Temporal-12345')).resolves.toBeInstanceOf(Headers);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'USER'));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe('CREATE');
    expect(logs[0]?.entityId).toBe(created.id);
    expect(JSON.stringify(logs[0]?.metadata)).not.toContain('Temporal-12345');

    await expect(
      usersService.createUser(db, actor, { name: 'Otra', email: 'nueva@test.cl', password: 'Temporal-12345', role: 'viewer' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('setUserRole cambia, quita y protege el rol admin propio', async () => {
    const admin = await createDirect(ADMIN.email, ADMIN.name, 'admin', ADMIN.password);
    const target = await createDirect('editor@test.cl', 'Editor', 'editor');
    const actor = actorFor(admin.id, admin.email);
    const headers = await sessionHeaders(ADMIN.email, ADMIN.password);

    // un admin puede nombrar a otro admin
    await expect(usersService.setUserRole(db, headers, actor, target.id, 'admin')).resolves.toEqual({ role: 'admin' });
    let [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row?.role).toBe('admin');

    await usersService.setUserRole(db, headers, actor, target.id, 'viewer');
    [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row?.role).toBe('viewer');

    // quitar rol → NULL directo
    await expect(usersService.setUserRole(db, headers, actor, target.id, null)).resolves.toEqual({ role: null });
    [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row?.role).toBeNull();

    // protección: el admin no puede quitarse ni cambiarse su propio rol
    await expect(usersService.setUserRole(db, headers, actor, admin.id, null)).rejects.toBeInstanceOf(ConflictError);
    await expect(usersService.setUserRole(db, headers, actor, admin.id, 'editor')).rejects.toBeInstanceOf(ConflictError);
    [row] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(row?.role).toBe('admin');

    await expect(usersService.setUserRole(db, headers, actor, 'no-existe', 'viewer')).rejects.toBeInstanceOf(NotFoundError);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, target.id));
    expect(logs.map((l) => l.action)).toEqual(['UPDATE', 'UPDATE', 'UPDATE']);
    expect(logs[0]?.metadata).toMatchObject({ before: { role: 'editor' }, after: { role: 'admin' } });
  });

  it('setUserPassword fija la temporal, obliga a cambiarla y cierra las sesiones del usuario', async () => {
    const admin = await createDirect(ADMIN.email, ADMIN.name, 'admin', ADMIN.password);
    const target = await createDirect('visor@test.cl', 'Visor', 'viewer', 'ClaveVieja-2026');
    const actor = actorFor(admin.id, admin.email);
    const headers = await sessionHeaders(ADMIN.email, ADMIN.password);

    // el usuario tiene una sesión abierta
    await sessionHeaders('visor@test.cl', 'ClaveVieja-2026');
    let targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions).toHaveLength(1);

    await usersService.setUserPassword(db, headers, actor, target.id, 'NuevaTemporal-99');

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row?.mustChangePassword).toBe(true);
    targetSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    expect(targetSessions).toHaveLength(0);

    // la clave anterior ya no sirve; la temporal sí
    await expect(auth.api.signInEmail({ body: { email: 'visor@test.cl', password: 'ClaveVieja-2026' } })).rejects.toThrow();
    await expect(sessionHeaders('visor@test.cl', 'NuevaTemporal-99')).resolves.toBeInstanceOf(Headers);

    // la sesión del admin sigue viva
    const adminSessions = await db.select().from(sessions).where(eq(sessions.userId, admin.id));
    expect(adminSessions.length).toBeGreaterThan(0);

    // no se asigna temporal a uno mismo desde el panel
    await expect(usersService.setUserPassword(db, headers, actor, admin.id, 'Otra-Temporal-99')).rejects.toBeInstanceOf(ConflictError);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, target.id));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]?.metadata)).not.toContain('NuevaTemporal-99');
  });

  it('deleteUser elimina a otros pero nunca al propio usuario', async () => {
    const admin = await createDirect(ADMIN.email, ADMIN.name, 'admin', ADMIN.password);
    const target = await createDirect('borrar@test.cl', 'Para Borrar', 'viewer');
    const actor = actorFor(admin.id, admin.email);
    const headers = await sessionHeaders(ADMIN.email, ADMIN.password);

    await expect(usersService.deleteUser(db, headers, actor, admin.id)).rejects.toBeInstanceOf(ConflictError);

    await usersService.deleteUser(db, headers, actor, target.id);
    const rows = await db.select().from(users).where(eq(users.id, target.id));
    expect(rows).toHaveLength(0);

    await expect(usersService.deleteUser(db, headers, actor, target.id)).rejects.toBeInstanceOf(NotFoundError);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, target.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe('DELETE');
    expect(logs[0]?.metadata).toMatchObject({ email: 'borrar@test.cl' });
  });

  it('las operaciones admin de Better Auth rechazan headers sin sesión', async () => {
    const admin = await createDirect(ADMIN.email, ADMIN.name, 'admin', ADMIN.password);
    const target = await createDirect('x@test.cl', 'X', 'viewer');
    const actor = actorFor(admin.id, admin.email);
    await expect(usersService.setUserRole(db, new Headers(), actor, target.id, 'editor')).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });
});
