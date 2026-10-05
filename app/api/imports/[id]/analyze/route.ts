import { db } from '@/db/client';
import { accepted, parseBody, parseParams, withActor } from '@/server/http';
import { startAnalyze } from '@/server/import/analyze';
import { uuidParamSchema } from '@/shared/schemas/common';
import { analyzeImportSchema } from '@/shared/schemas/imports';

/** `POST /api/imports/:id/analyze` → 202. El análisis corre en el worker; la UI consulta `GET /api/imports/:id`. */
export const POST = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    const input = await parseBody(req, analyzeImportSchema);
    await startAnalyze(db, actor, id, input);
    return accepted({ importId: id, status: 'ANALYZING' });
  },
  { roles: ['editor', 'admin'] },
);
