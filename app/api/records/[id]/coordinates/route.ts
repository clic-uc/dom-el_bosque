import { db } from '@/db/client';
import { json, parseBody, parseParams, withActor } from '@/server/http';
import * as recordsService from '@/server/services/records';
import { idParamSchema } from '@/shared/schemas/common';
import { updateCoordinatesSchema } from '@/shared/schemas/records';

/** PATCH /api/records/:id/coordinates (editor/admin): `{ lat, lon, scope }` o `{ useRole: true }` → { updated } (§8.3). */
export const PATCH = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const input = await parseBody(req, updateCoordinatesSchema);
    const result = await recordsService.updateCoordinates(db, actor, id, input);
    return json(result);
  },
  { roles: ['editor', 'admin'] },
);
