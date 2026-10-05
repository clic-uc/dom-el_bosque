import { db } from '@/db/client';
import { json, parseBody, parseParams, privateNoStore, withActor } from '@/server/http';
import * as polygonsService from '@/server/services/polygons';
import { idParamSchema } from '@/shared/schemas/common';
import { updatePolygonSchema } from '@/shared/schemas/polygons';

/** GET detalle (adjuntos, conteos por capa, sector); PATCH nombre/propiedades (editor/admin). */
export const GET = withActor<{ id: string }>(async ({ params }) => {
  const id = parseParams(params.id, idParamSchema);
  const detail = await polygonsService.getPolygon(db, id);
  return json(detail, { headers: privateNoStore });
});

export const PATCH = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const patch = await parseBody(req, updatePolygonSchema);
    const detail = await polygonsService.updatePolygon(db, actor, id, patch);
    return json(detail);
  },
  { roles: ['editor', 'admin'] },
);
