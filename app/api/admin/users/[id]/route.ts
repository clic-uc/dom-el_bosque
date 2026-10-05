import { db } from '@/db/client';
import { noContent, withActor } from '@/server/http';
import { rateLimit, rateLimits } from '@/server/rate-limit';
import * as usersService from '@/server/services/users';

/** DELETE elimina la cuenta (solo admin; nunca la propia). `req.headers` lleva la sesión admin que exige Better Auth. */
export const DELETE = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    rateLimit(`admin:${actor.userId}`, rateLimits.admin);
    await usersService.deleteUser(db, req.headers, actor, params.id);
    return noContent();
  },
  { roles: ['admin'] },
);
