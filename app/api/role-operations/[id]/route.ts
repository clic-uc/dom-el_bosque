import { db } from '@/db/client';
import { noContent, parseBody, parseParams, withActor } from '@/server/http';
import * as roleOperationsService from '@/server/services/roleOperations';
import { idParamSchema } from '@/shared/schemas/common';
import { deleteRoleOperationSchema } from '@/shared/schemas/roles';

/** DELETE /api/role-operations/:id (admin) con `{ reason }` → 204. Recalcula la vigencia de los orígenes. */
export const DELETE = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const { reason } = await parseBody(req, deleteRoleOperationSchema);
    await roleOperationsService.deleteOperation(db, actor, id, reason);
    return noContent();
  },
  { roles: ['admin'] },
);
