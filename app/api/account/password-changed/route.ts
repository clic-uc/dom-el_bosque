import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { json, withActor } from '@/server/http';

/**
 * Apaga `must_change_password` después de que el usuario cambió su contraseña con Better Auth (§6.1).
 * Se permite con contraseña temporal porque es justamente el paso que la reemplaza.
 */
export const POST = withActor(
  async ({ actor }) => {
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, actor.userId));
    return json({ ok: true });
  },
  { allowPasswordChangeRequired: true },
);
