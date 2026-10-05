import type { PgBoss } from 'pg-boss';
import { logger } from '../logger';

/**
 * Handlers de pg-boss para importaciones (§8.5) y geocodificación externa (§8.7).
 * Se completan en la fase 7: `import.analyze`, `import.commit`, `import.geocode-external` (concurrencia 1),
 * `import.cleanup` (diario).
 */
export async function registerImportHandlers(_boss: PgBoss): Promise<void> {
  logger.info('Handlers de importación: pendientes de la fase 7');
}
