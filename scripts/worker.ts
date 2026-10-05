/**
 * Proceso worker (§2): consume las colas de pg-boss. Misma base de código que la app.
 *
 *   pnpm worker            (desarrollo, con recarga)
 *   node scripts/worker.js (Docker)
 */
import './_env';
process.env.SIGDOM_PROCESS = 'worker';

import { getBoss, stopBoss } from '@/server/jobs/boss';
import { registerHandlers } from '@/server/jobs/handlers';
import { logger } from '@/server/logger';

async function main() {
  const boss = await getBoss('worker');
  await registerHandlers(boss);
  logger.info('Worker listo: escuchando colas');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Deteniendo worker…');
    await stopBoss();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'El worker no pudo iniciar');
  process.exit(1);
});
