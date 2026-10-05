import { db } from '@/db/client';
import { json, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as auditService from '@/server/services/audit';
import { auditLogsQuerySchema } from '@/shared/schemas/audit';

/** GET auditoría paginada (§3.2 punto 16): admin ve todo; visor/editor solo lo propio (lo resuelve `listLogs`). */
export const GET = withActor(async ({ req, actor }) => {
  const q = parseQuery(req, auditLogsQuerySchema);
  const result = await auditService.listLogs(db, actor, q);
  return json(result, { headers: privateNoStore });
});
