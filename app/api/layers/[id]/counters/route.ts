import { db } from '@/db/client';
import { json, parseBody, parseParams, privateNoStore, withActor } from '@/server/http';
import * as numberingService from '@/server/services/numbering';
import { idParamSchema } from '@/shared/schemas/common';
import { setNextNumberSchema } from '@/shared/schemas/records';

type Params = { id: string };

/** GET /api/layers/:id/counters → `LayerCounter[]` (editor/admin, §7.12). Vacío si la capa no tiene correlativo. */
export const GET = withActor<Params>(
  async ({ params }) => {
    const id = parseParams(params.id, idParamSchema);
    const counters = await numberingService.getCounters(db, id);
    return json(counters, { headers: privateNoStore });
  },
  { roles: ['editor', 'admin'] },
);

/** PUT /api/layers/:id/counters `{ period?, next, reason }` → `{ next }` (solo admin). */
export const PUT = withActor<Params>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const input = await parseBody(req, setNextNumberSchema);
    const result = await numberingService.setNextNumber(db, actor, id, input.period, input.next, input.reason);
    return json(result);
  },
  { roles: ['admin'] },
);
