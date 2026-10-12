import { PgBoss } from 'pg-boss';
import { env } from '@/env';
import { capabilities } from '@/shared/capabilities';
import { logger } from '../logger';

/** Colas de pg-boss (§2, §8.5, §8.7). */
export const queues = {
  importAnalyze: 'import.analyze',
  importCommit: 'import.commit',
  importGeocodeExternal: 'import.geocode-external',
  importCleanup: 'import.cleanup',
  ping: 'system.ping',
} as const;

export type QueueName = (typeof queues)[keyof typeof queues];

export type JobPayloads = {
  'import.analyze': { importId: string };
  'import.commit': { importId: string };
  'import.geocode-external': { importId: string; rowNumber: number };
  'import.cleanup': Record<string, never>;
  'system.ping': { message: string };
};

declare global {
  var __sigdomBoss: Promise<PgBoss> | undefined;
}

export type BossMode = 'producer' | 'worker';

async function createBoss(mode: BossMode): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
    // Solo el worker supervisa y agenda; la app solo encola.
    supervise: mode === 'worker',
    schedule: mode === 'worker',
    migrate: true,
    max: mode === 'worker' ? 5 : 2,
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  for (const name of Object.values(queues)) {
    try {
      await boss.createQueue(name, name === queues.importGeocodeExternal ? { policy: 'standard' } : undefined);
    } catch {
      // la cola ya existe
    }
  }
  return boss;
}

/** Instancia compartida (una por proceso). La app usa `producer`; `scripts/worker.ts` usa `worker`. */
export function getBoss(mode: BossMode = 'producer'): Promise<PgBoss> {
  if (!globalThis.__sigdomBoss) globalThis.__sigdomBoss = createBoss(mode);
  return globalThis.__sigdomBoss;
}

export async function enqueue<Q extends QueueName>(
  queue: Q,
  data: JobPayloads[Q],
  options?: Parameters<PgBoss['send']>[2],
): Promise<string | null> {
  // Staging (Vercel): sin worker ni pg-boss; la tarea corre en esta misma invocación (ver ./inline).
  if (capabilities.inlineJobs) {
    const { runInline } = await import('./inline');
    await runInline(queue, data);
    return null;
  }
  const boss = await getBoss();
  return boss.send(queue, data, options ?? {});
}

export async function stopBoss(): Promise<void> {
  if (!globalThis.__sigdomBoss) return;
  const boss = await globalThis.__sigdomBoss;
  await boss.stop({ graceful: true, timeout: 10_000 });
  globalThis.__sigdomBoss = undefined;
}
