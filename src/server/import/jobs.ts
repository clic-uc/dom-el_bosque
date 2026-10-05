import type { PgBoss } from 'pg-boss';
import { db } from '@/db/client';
import { queues, type JobPayloads } from '../jobs/boss';
import { logger } from '../logger';
import { runAnalyze } from './analyze';
import { cleanupExpiredImports } from './cleanup';
import { runCommit } from './commit';
import { runGeocodeExternal } from './geocode-external';

/**
 * Handlers de pg-boss para importaciones (§8.5) y geocodificación externa (§8.7).
 * `import.analyze` y `import.commit` nunca lanzan: dejan la importación en REVIEW/COMPLETED o FAILED.
 * `import.geocode-external` corre de a una tarea (el throttle global ya limita a 1 req/s).
 */
export async function registerImportHandlers(boss: PgBoss): Promise<void> {
  await boss.work<JobPayloads['import.analyze']>(queues.importAnalyze, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, importId: job.data.importId }, 'import.analyze');
      await runAnalyze(db, job.data.importId);
    }
  });

  await boss.work<JobPayloads['import.commit']>(queues.importCommit, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, importId: job.data.importId }, 'import.commit');
      await runCommit(db, job.data.importId);
    }
  });

  await boss.work<JobPayloads['import.geocode-external']>(
    queues.importGeocodeExternal,
    { batchSize: 1, localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await runGeocodeExternal(db, job.data.importId, job.data.rowNumber);
      }
    },
  );

  await boss.schedule(queues.importCleanup, '0 3 * * *', {}, { tz: 'America/Santiago' });
  await boss.work<JobPayloads['import.cleanup']>(queues.importCleanup, { batchSize: 1 }, async () => {
    try {
      await cleanupExpiredImports(db);
    } catch (err) {
      logger.error({ err }, 'import.cleanup falló');
    }
  });

  logger.info('Handlers de importación registrados');
}
