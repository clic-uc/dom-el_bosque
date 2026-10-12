import { capabilities } from '@/shared/capabilities';
import { logger } from '../logger';
import type { JobPayloads, QueueName } from './boss';

/**
 * Tareas sin worker (staging en Vercel, `capabilities.inlineJobs`): corren en la misma invocación, después de
 * responder, con `after()` de Next (la plataforma mantiene viva la función hasta `maxDuration`).
 * Los handlers se importan de forma dinámica: `import/analyze` y `import/commit` importan `jobs/boss`, que a su
 * vez llama a este módulo. `next/server` también es dinámico para que el worker y los scripts no dependan de Next.
 */
async function schedule(label: string, task: () => Promise<unknown>): Promise<void> {
  const { after } = await import('next/server');
  after(async () => {
    try {
      await task();
    } catch (err) {
      logger.error({ err, task: label }, 'Tarea en segundo plano falló');
    }
  });
}

export async function runInline<Q extends QueueName>(queue: Q, data: JobPayloads[Q]): Promise<void> {
  const { db } = await import('@/db/client');
  if (queue === 'import.analyze') {
    const { importId } = data as JobPayloads['import.analyze'];
    await schedule(queue, async () => (await import('../import/analyze')).runAnalyze(db, importId));
    return;
  }
  if (queue === 'import.commit') {
    const { importId } = data as JobPayloads['import.commit'];
    await schedule(queue, async () => (await import('../import/commit')).runCommit(db, importId));
    return;
  }
  // Geocodificación externa, limpieza y ping solo existen con worker; en staging no se encolan.
  logger.warn({ queue }, 'Tarea sin worker: se omite');
}

/**
 * La limpieza diaria `import.cleanup` (03:00) la agenda el worker. Sin worker se ejecuta de forma oportunista,
 * después de responder, cada vez que alguien sube una importación nueva.
 */
export async function cleanupWithoutWorker(): Promise<void> {
  if (!capabilities.inlineJobs) return;
  const { db } = await import('@/db/client');
  await schedule('import.cleanup', async () => (await import('../import/cleanup')).cleanupExpiredImports(db));
}
