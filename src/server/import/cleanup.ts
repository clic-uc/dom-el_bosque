import { and, inArray, lt } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { imports } from '@/db/schema';
import { logger } from '../logger';
import { discardRows } from './review';

/** Tarea diaria `import.cleanup` (§8.5): borradores vencidos → DISCARDED, se borran filas y archivo. */
export async function cleanupExpiredImports(db: DbOrTx, now = new Date()): Promise<number> {
  const expired = await db
    .select({ id: imports.id, fileKey: imports.fileKey })
    .from(imports)
    .where(and(lt(imports.expiresAt, now), inArray(imports.status, ['UPLOADED', 'ANALYZING', 'REVIEW', 'FAILED'])));
  for (const imp of expired) {
    try {
      await discardRows(db, imp);
    } catch (err) {
      logger.error({ err, importId: imp.id }, 'import.cleanup: no se pudo descartar el borrador');
    }
  }
  if (expired.length) logger.info({ count: expired.length }, 'import.cleanup: borradores vencidos descartados');
  return expired.length;
}
