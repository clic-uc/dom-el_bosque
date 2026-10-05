import { db } from '@/db/client';
import { json, noContent, parseBody, privateNoStore, withActor } from '@/server/http';
import * as rolesService from '@/server/services/roles';
import { updateRoleSchema } from '@/shared/schemas/roles';

/** GET /api/roles/:roleId → Role (con `vigente` y `resultRoleIds`). */
export const GET = withActor<{ roleId: string }>(async ({ params }) => {
  const role = await rolesService.getRole(db, rolesService.parseRoleIdParam(params.roleId));
  return json(role, { headers: privateNoStore });
});

/** PATCH /api/roles/:roleId (editor/admin): lat/lon/address; las coordenadas se propagan según §8.3. */
export const PATCH = withActor<{ roleId: string }>(
  async ({ req, params, actor }) => {
    const roleId = rolesService.parseRoleIdParam(params.roleId);
    const patch = await parseBody(req, updateRoleSchema);
    const role = await rolesService.updateRole(db, actor, roleId, patch);
    return json(role);
  },
  { roles: ['editor', 'admin'] },
);

/** DELETE /api/roles/:roleId (editor/admin) → 204. Conflict si participa en operaciones. */
export const DELETE = withActor<{ roleId: string }>(
  async ({ params, actor }) => {
    await rolesService.deleteRole(db, actor, rolesService.parseRoleIdParam(params.roleId));
    return noContent();
  },
  { roles: ['editor', 'admin'] },
);
