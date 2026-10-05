import { db } from '@/db/client';
import { accepted, parseBody, parseParams, withActor } from '@/server/http';
import { startCommit } from '@/server/import/commit';
import { uuidParamSchema } from '@/shared/schemas/common';
import { importCommitSchema } from '@/shared/schemas/imports';

/** `POST /api/imports/:id/commit` → 202. Escribe en el worker; la UI sigue el progreso con `GET /api/imports/:id`. */
export const POST = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    const input = await parseBody(req, importCommitSchema);
    await startCommit(db, actor, id, input);
    return accepted({ importId: id, status: 'COMMITTING' });
  },
  { roles: ['editor', 'admin'] },
);
