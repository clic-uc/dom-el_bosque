import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sqlClient } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { auth } from './index';

/** Tests con BD real: el cambio de contraseña pasa por los hooks de Better Auth (`./index.ts`). */

const TEMP = 'ClaveTemporal-2026';
const NEW = 'ClaveNueva-2026!';

async function createUser(email: string, mustChangePassword: boolean) {
  const res = await auth.api.createUser({
    body: { email, name: 'Usuario Test', password: TEMP, role: 'editor', data: { mustChangePassword } },
  });
  return res.user;
}

/** Headers con la cookie de sesión de un usuario, como las que llegan a un Route Handler. */
async function sessionHeaders(email: string, password: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return new Headers({ cookie });
}

async function mustChange(id: string) {
  const [row] = await db.select({ v: users.mustChangePassword }).from(users).where(eq(users.id, id));
  return row?.v;
}

describe('cambio de contraseña', () => {
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, sessions, accounts, verifications, audit_logs RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  it('apaga must_change_password en la base solo para quien cambió su contraseña', async () => {
    const user = await createUser('temporal@test.cl', true);
    const other = await createUser('otro@test.cl', true);
    const headers = await sessionHeaders('temporal@test.cl', TEMP);

    const res = await auth.api.changePassword({ body: { currentPassword: TEMP, newPassword: NEW }, headers });
    // La respuesta trae el usuario de la sesión anterior; lo que vale es la base.
    expect(res.user.id).toBe(user.id);
    expect(await mustChange(user.id)).toBe(false);
    expect(await mustChange(other.id)).toBe(true);
  });

  it('cierra las otras sesiones aunque el cliente pida conservarlas', async () => {
    const user = await createUser('temporal@test.cl', true);
    const headers = await sessionHeaders('temporal@test.cl', TEMP);
    const otherSession = await sessionHeaders('temporal@test.cl', TEMP);

    await auth.api.changePassword({
      body: { currentPassword: TEMP, newPassword: NEW, revokeOtherSessions: false },
      headers,
    });

    expect(await auth.api.getSession({ headers: otherSession })).toBeNull();
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('rechaza repetir la contraseña actual y la marca sigue encendida', async () => {
    const user = await createUser('temporal@test.cl', true);
    const headers = await sessionHeaders('temporal@test.cl', TEMP);

    await expect(
      auth.api.changePassword({ body: { currentPassword: TEMP, newPassword: TEMP }, headers }),
    ).rejects.toMatchObject({ body: { code: 'PASSWORD_UNCHANGED' } });
    expect(await mustChange(user.id)).toBe(true);
  });

  it('con la contraseña actual incorrecta no apaga la marca', async () => {
    const user = await createUser('temporal@test.cl', true);
    const headers = await sessionHeaders('temporal@test.cl', TEMP);

    await expect(
      auth.api.changePassword({ body: { currentPassword: 'OtraClave-2026', newPassword: NEW }, headers }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } });
    expect(await mustChange(user.id)).toBe(true);
  });

  it('los hooks no alteran otros endpoints', async () => {
    const user = await createUser('temporal@test.cl', true);
    const headers = await sessionHeaders('temporal@test.cl', TEMP);

    const session = await auth.api.getSession({ headers });
    expect(session?.user.id).toBe(user.id);
    expect(await mustChange(user.id)).toBe(true);
  });
});
