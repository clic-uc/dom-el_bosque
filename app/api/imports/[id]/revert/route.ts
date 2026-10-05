import { db } from '@/db/client';
import { json, parseBody, parseParams, withActor } from '@/server/http';
import { revertImport } from '@/server/import/revert';
import { uuidParamSchema } from '@/shared/schemas/common';
import { importRevertSchema } from '@/shared/schemas/imports';

/** `POST /api/imports/:id/revert` (editor: propias; admin: todas). `Conflict` si hubo cambios posteriores, salvo `force`. */
export const POST = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    const input = await parseBody(req, importRevertSchema);
    const result = await revertImport(db, actor, id, input);
    return json(result);
  },
  { roles: ['editor', 'admin'] },
);
