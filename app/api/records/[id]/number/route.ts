import { db } from '@/db/client';
import { json, parseBody, parseParams, withActor } from '@/server/http';
import * as numberingService from '@/server/services/numbering';
import { idParamSchema } from '@/shared/schemas/common';
import { setNumberSchema } from '@/shared/schemas/records';

/** POST /api/records/:id/number (editor/admin) → { number, fieldKey } (§8.8). */
export const POST = withActor<{ id: string }>(
  async ({ params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const result = await numberingService.assignNumber(db, actor, id);
    return json(result);
  },
  { roles: ['editor', 'admin'] },
);

/** PUT /api/records/:id/number (admin): corrección excepcional `{ value | null, reason }` → { number }. */
export const PUT = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const { value, reason } = await parseBody(req, setNumberSchema);
    const result = await numberingService.setNumber(db, actor, id, value, reason);
    return json(result);
  },
  { roles: ['admin'] },
);
