import { db } from '@/db/client';
import { json, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as rolesService from '@/server/services/roles';
import { rolesSearchSchema } from '@/shared/schemas/roles';

/** GET /api/roles?q=&limit= → Role[] (prefijo de rol o dirección del padrón, §7.4). */
export const GET = withActor(async ({ req }) => {
  const { q, limit } = parseQuery(req, rolesSearchSchema);
  const data = await rolesService.searchRoles(db, q, limit);
  return json(data, { headers: privateNoStore });
});
