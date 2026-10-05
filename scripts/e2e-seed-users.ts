/**
 * Crea (o restablece) los usuarios de prueba para Playwright (§12.5). Idempotente.
 *
 *   pnpm e2e:seed            # admin@e2e.test, editor@e2e.test y viewer@e2e.test
 *   pnpm e2e:seed --temp     # además temporal@e2e.test con contraseña temporal (must_change_password = true)
 *
 * Contraseña de todos: `Sigdom-e2e-2026!` (ver e2e/fixtures.ts). Si el usuario ya existe, se restablecen
 * su rol, su contraseña y el flag, y se cierran sus sesiones, para que la suite sea repetible.
 *
 * Solo para entornos de prueba: nunca ejecutar contra la base de producción.
 */
import './_env';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, sqlClient } from '@/db/client';
import { accounts, sessions, users } from '@/db/schema';
import { auth } from '@/server/auth';
import type { UserRole } from '@/shared/constants';

const E2E_PASSWORD = 'Sigdom-e2e-2026!';

type SeedUser = { email: string; name: string; role: UserRole; mustChangePassword: boolean };

const SEED_USERS: SeedUser[] = [
  { email: 'admin@e2e.test', name: 'Admin E2E', role: 'admin', mustChangePassword: false },
  { email: 'editor@e2e.test', name: 'Editor E2E', role: 'editor', mustChangePassword: false },
  { email: 'viewer@e2e.test', name: 'Visor E2E', role: 'viewer', mustChangePassword: false },
  { email: 'temporal@e2e.test', name: 'Temporal E2E', role: 'editor', mustChangePassword: true },
];

async function upsertUser(u: SeedUser): Promise<'creado' | 'restablecido'> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email)).limit(1);

  if (!existing) {
    await auth.api.createUser({
      body: {
        email: u.email,
        password: E2E_PASSWORD,
        name: u.name,
        role: u.role,
        data: { mustChangePassword: u.mustChangePassword },
      },
    });
    return 'creado';
  }

  // Usuario existente: restablecer contraseña, rol y flag para que la suite sea repetible.
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(E2E_PASSWORD);
  await db.update(accounts).set({ password: hash }).where(eq(accounts.userId, existing.id));
  await db
    .update(users)
    .set({
      name: u.name,
      role: u.role,
      banned: false,
      mustChangePassword: u.mustChangePassword,
    })
    .where(eq(users.id, existing.id));
  // Cerrar sesiones abiertas para que el estado de autenticación guardado por Playwright no quede inconsistente.
  await db.delete(sessions).where(eq(sessions.userId, existing.id));
  return 'restablecido';
}

async function main() {
  const { values } = parseArgs({ options: { temp: { type: 'boolean', default: false } } });
  if (process.env.NODE_ENV === 'production' && !process.env.E2E_ALLOW_PRODUCTION) {
    console.error(
      'Este script crea usuarios de prueba con contraseña conocida: no se ejecuta en producción.',
    );
    process.exit(1);
  }
  const selected = SEED_USERS.filter((u) => values.temp || !u.mustChangePassword);
  for (const u of selected) {
    const result = await upsertUser(u);
    console.log(`${u.email} (${u.role}${u.mustChangePassword ? ', contraseña temporal' : ''}): ${result}`);
  }
  await sqlClient.end();
}

main().catch((err) => {
  console.error('No se pudieron crear los usuarios e2e:', err?.body?.message ?? err);
  process.exit(1);
});
