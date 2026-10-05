import type { PgBoss } from 'pg-boss';
import { logger } from '../logger';
import { queues, type JobPayloads } from './boss';

/**
 * Registro de handlers del worker. Las tareas de importación se registran desde `server/import/jobs.ts`
 * (fase 7); aquí va la infraestructura común y la tarea de prueba.
 */
export async function registerHandlers(boss: PgBoss): Promise<void> {
  await boss.work<JobPayloads['system.ping']>(queues.ping, async (jobs) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, message: job.data.message }, 'ping recibido');
    }
  });

  // Importaciones (§8.5) y geocodificación externa (§8.7)
  const importJobs = await import('../import/jobs').catch(() => null);
  if (importJobs?.registerImportHandlers) {
    await importJobs.registerImportHandlers(boss);
  } else {
    logger.warn('Handlers de importación no disponibles todavía');
  }
}
