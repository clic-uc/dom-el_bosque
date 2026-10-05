import { db } from '@/db/client';
import { noContent, parseBody, withActor } from '@/server/http';
import { rateLimit, rateLimits } from '@/server/rate-limit';
import * as usersService from '@/server/services/users';
import { setUserPasswordSchema } from '@/shared/schemas/users';

/** PUT { password }: contraseña temporal, cambio obligatorio y cierre de sesiones del usuario (solo admin). */
export const PUT = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    rateLimit(`admin:${actor.userId}`, rateLimits.admin);
    const { password } = await parseBody(req, setUserPasswordSchema);
    await usersService.setUserPassword(db, req.headers, actor, params.id, password);
    return noContent();
  },
  { roles: ['admin'] },
);
