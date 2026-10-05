import { db } from '@/db/client';
import { json, parseParams, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as layersService from '@/server/services/layers';
import { idParamSchema } from '@/shared/schemas/common';
import { duplicatesPreviewQuerySchema } from '@/shared/schemas/records';

type Params = { id: string };

/** GET /api/layers/:id/duplicates?keys=a,b → `DuplicatesPreview` (editor/admin, §7.1). */
export const GET = withActor<Params>(
  async ({ req, params }) => {
    const id = parseParams(params.id, idParamSchema);
    const { keys } = parseQuery(req, duplicatesPreviewQuerySchema);
    const preview = await layersService.previewDuplicates(db, id, keys);
    return json(preview, { headers: privateNoStore });
  },
  { roles: ['editor', 'admin'] },
);
