import { db } from '@/db/client';
import { created, json, parseBody, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as roleOperationsService from '@/server/services/roleOperations';
import { createRoleOperationSchema, roleOperationsQuerySchema } from '@/shared/schemas/roles';

/** GET /api/role-operations → Paginated<RoleOperation> con filtros type/from/to/roleId (§7.11). */
export const GET = withActor(async ({ req }) => {
  const query = parseQuery(req, roleOperationsQuerySchema);
  const data = await roleOperationsService.listOperations(db, query);
  return json(data, { headers: privateNoStore });
});

/** POST /api/role-operations (editor/admin) → RoleOperation 201 (§8.9). */
export const POST = withActor(
  async ({ req, actor }) => {
    const input = await parseBody(req, createRoleOperationSchema);
    const operation = await roleOperationsService.createOperation(db, actor, input);
    return created(operation);
  },
  { roles: ['editor', 'admin'] },
);
