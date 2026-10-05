import type { PgBoss } from 'pg-boss';
import { registerImportHandlers } from '../import/jobs';
import { logger } from '../logger';
import { queues, type JobPayloads } from './boss';

/** Registro de handlers del worker: tarea de prueba + importaciones (§8.5) y geocodificación externa (§8.7). */
export async function registerHandlers(boss: PgBoss): Promise<void> {
  await boss.work<JobPayloads['system.ping']>(queues.ping, async (jobs) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, message: job.data.message }, 'ping recibido');
    }
  });

  await registerImportHandlers(boss);
}
