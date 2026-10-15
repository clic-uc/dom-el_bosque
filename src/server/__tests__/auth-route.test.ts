/**
 * Handler de Better Auth (`app/api/auth/[...all]/route.ts`): solo responden los endpoints que usa la interfaz.
 * Con BD real: hacen falta usuarios y cookies de verdad, no un `getActor` simulado.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/auth/[...all]/route';
import { db, sqlClient } from '@/db/client';
import { users } from '@/db/schema';
import { env } from '@/env';
import { auth } from '@/server/auth';
import { roles } from '@/shared/permissions';

const ADMIN = { email: 'admin@test.cl', password: 'ClaveAdmin-2026' };
const ORIGIN = new URL(env.BETTER_AUTH_URL).origin;

async function createUser(email: string, password: string, role: 'admin' | 'viewer') {
  const res = await auth.api.createUser({ body: { email, name: 'Usuario Test', password, role } });
  return res.user;
}

/** Cookie de sesión; por `auth.api` para no gastar el límite de 5 ingresos por minuto. */
async function sessionCookie(email: string, password: string): Promise<string> {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function req(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; cookie?: string } = {}): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.method === 'POST') headers['content-type'] = 'application/json';
  return new Request(`http://localhost/api/auth/${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined,
  });
}

const call = (r: Request) => (r.method === 'POST' ? POST(r) : GET(r));

describe('handler de /api/auth', () => {
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, sessions, accounts, verifications, audit_logs RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  it('los endpoints del plugin admin responden 404 aunque llame un administrador', async () => {
    const admin = await createUser(ADMIN.email, ADMIN.password, 'admin');
    const viewer = await createUser('visor@test.cl', 'ClaveVisor-2026', 'viewer');
    const cookie = await sessionCookie(ADMIN.email, ADMIN.password);

    const cases = [
      req('admin/set-role', { method: 'POST', body: { userId: admin.id, role: 'viewer' }, cookie }),
      req('admin/impersonate-user', { method: 'POST', body: { userId: viewer.id }, cookie }),
      req('admin/update-user', {
        method: 'POST',
        body: { userId: viewer.id, data: { role: 'admin' } },
        cookie,
      }),
      req('admin/list-users', { cookie }),
    ];
    for (const r of cases) {
      const res = await call(r);
      expect(res.status, r.url).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }

    const rows = await db.select({ id: users.id, role: users.role }).from(users).orderBy(users.email);
    expect(rows).toEqual([
      { id: admin.id, role: 'admin' },
      { id: viewer.id, role: 'viewer' },
    ]);
  });

  it('rutas parecidas a las permitidas responden 404', async () => {
    for (const path of [
      'Sign-In/email',
      '/sign-in/email',
      'sign-in%2Femail',
      'sign-in/email/',
      'sign-up/email',
    ]) {
      const res = await call(
        req(path, { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } }),
      );
      expect(res.status, path).toBe(404);
    }
  });

  it('sign-in/email y get-session siguen funcionando', async () => {
    const admin = await createUser(ADMIN.email, ADMIN.password, 'admin');

    const signIn = await call(
      req('sign-in/email', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } }),
    );
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');

    const session = await call(req('get-session', { cookie }));
    expect(session.status).toBe(200);
    expect((await session.json()).user.id).toBe(admin.id);
  });

  it('update-user cambia el nombre de quien llama', async () => {
    const viewer = await createUser('visor@test.cl', 'ClaveVisor-2026', 'viewer');
    const cookie = await sessionCookie('visor@test.cl', 'ClaveVisor-2026');

    const res = await call(req('update-user', { method: 'POST', body: { name: 'Nombre Nuevo' }, cookie }));
    expect(res.status).toBe(200);
    const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, viewer.id));
    expect(row?.name).toBe('Nombre Nuevo');
  });
});

describe('permisos de Better Auth del rol admin', () => {
  it('solo trae los que usa la gestión de usuarios', () => {
    expect(
      roles.admin.authorize({ user: ['set-role', 'set-password', 'delete'], session: ['revoke'] }).success,
    ).toBe(true);
    for (const p of ['impersonate', 'update', 'ban', 'set-email', 'create', 'list', 'get'] as const) {
      expect(roles.admin.authorize({ user: [p] }).success, p).toBe(false);
    }
  });
});
