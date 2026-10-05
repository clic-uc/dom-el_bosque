import { db } from '@/db/client';
import { created, json, parseBody, withActor } from '@/server/http';
import * as layersService from '@/server/services/layers';
import { createLayerSchema } from '@/shared/schemas/layers';

export const GET = withActor(async () => {
  const data = await layersService.listLayers(db);
  return json(data, { headers: { 'Cache-Control': 'private, no-store' } });
});

export const POST = withActor(
  async ({ req, actor }) => {
    const input = await parseBody(req, createLayerSchema);
    const layer = await layersService.createLayer(db, actor, input);
    return created(layer);
  },
  { roles: ['editor', 'admin'] },
);
