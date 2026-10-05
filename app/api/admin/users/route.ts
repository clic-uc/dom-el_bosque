import { db } from '@/db/client';
import { created, json, parseBody, parseQuery, privateNoStore, withActor } from '@/server/http';
import { rateLimit, rateLimits } from '@/server/rate-limit';
import * as usersService from '@/server/services/users';
import { createUserSchema, usersQuerySchema } from '@/shared/schemas/users';

/** GET lista/búsqueda de usuarios; POST crea una cuenta con contraseña temporal (§9, solo admin). */
export const GET = withActor(
  async ({ req, actor }) => {
    rateLimit(`admin:${actor.userId}`, rateLimits.admin);
    const q = parseQuery(req, usersQuerySchema);
    const result = await usersService.listUsers(db, q);
    return json(result, { headers: privateNoStore });
  },
  { roles: ['admin'] },
);

export const POST = withActor(
  async ({ req, actor }) => {
    rateLimit(`admin:${actor.userId}`, rateLimits.admin);
    const input = await parseBody(req, createUserSchema);
    const user = await usersService.createUser(db, actor, input);
    return created(user);
  },
  { roles: ['admin'] },
);
