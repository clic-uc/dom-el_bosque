import { db } from '@/db/client';
import { json, parseBody, withActor } from '@/server/http';
import { rateLimit, rateLimits } from '@/server/rate-limit';
import * as usersService from '@/server/services/users';
import { setUserRoleSchema } from '@/shared/schemas/users';

/** PUT { role: 'admin' | 'editor' | 'viewer' | null } → { role } (solo admin). */
export const PUT = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    rateLimit(`admin:${actor.userId}`, rateLimits.admin);
    const { role } = await parseBody(req, setUserRoleSchema);
    const result = await usersService.setUserRole(db, req.headers, actor, params.id, role);
    return json(result);
  },
  { roles: ['admin'] },
);
