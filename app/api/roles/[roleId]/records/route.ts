import { db } from '@/db/client';
import { json, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as rolesService from '@/server/services/roles';
import { roleRecordsQuerySchema } from '@/shared/schemas/roles';

/** GET /api/roles/:roleId/records?includeLineage= → RoleRecords agrupado por departamento y capa (§7.4). */
export const GET = withActor<{ roleId: string }>(async ({ req, params }) => {
  const roleId = rolesService.parseRoleIdParam(params.roleId);
  const { includeLineage } = parseQuery(req, roleRecordsQuerySchema);
  const data = await rolesService.getRoleRecords(db, roleId, { includeLineage });
  return json(data, { headers: privateNoStore });
});
