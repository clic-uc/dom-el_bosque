import { z } from 'zod';
import { db } from '@/db/client';
import { json, parseParams, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as layersService from '@/server/services/layers';
import { fieldTypes } from '@/shared/constants';
import { idParamSchema } from '@/shared/schemas/common';
import { fieldKeySchema } from '@/shared/schemas/layers';

type Params = { id: string; key: string };

const querySchema = z.object({
  toType: z.enum(fieldTypes, { error: 'Indica a qué tipo quieres convertir el campo' }),
});

/** GET /api/layers/:id/fields/:key/convert-preview?toType= → `TypeConversionPreview` (editor/admin, §7.2). */
export const GET = withActor<Params>(
  async ({ req, params }) => {
    const id = parseParams(params.id, idParamSchema);
    const key = parseParams(params.key, fieldKeySchema);
    const { toType } = parseQuery(req, querySchema);
    const preview = await layersService.previewFieldTypeChange(db, id, key, toType);
    return json(preview, { headers: privateNoStore });
  },
  { roles: ['editor', 'admin'] },
);
