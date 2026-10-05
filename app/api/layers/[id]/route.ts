import { db } from '@/db/client';
import { json, noContent, parseBody, parseParams, privateNoStore, withActor } from '@/server/http';
import * as layersService from '@/server/services/layers';
import { idParamSchema } from '@/shared/schemas/common';
import { updateLayerSchema } from '@/shared/schemas/layers';

type Params = { id: string };

/** GET /api/layers/:id → `LayerWithCount` (viewer+). */
export const GET = withActor<Params>(async ({ params }) => {
  const id = parseParams(params.id, idParamSchema);
  const layer = await layersService.getLayer(db, id);
  return json(layer, { headers: privateNoStore });
});

/** PATCH /api/layers/:id → `Layer` (editor/admin). Acepta `renames` y `convertTypes` (§7.2). */
export const PATCH = withActor<Params>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const patch = await parseBody(req, updateLayerSchema);
    const layer = await layersService.updateLayer(db, actor, id, patch);
    return json(layer);
  },
  { roles: ['editor', 'admin'] },
);

/** DELETE /api/layers/:id → 204 (editor/admin). Borra en cascada registros, contadores e importaciones. */
export const DELETE = withActor<Params>(
  async ({ params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    await layersService.deleteLayer(db, actor, id);
    return noContent();
  },
  { roles: ['editor', 'admin'] },
);
