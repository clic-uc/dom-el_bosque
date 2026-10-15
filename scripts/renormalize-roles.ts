/**
 * Recalcula la dirección normalizada de los roles del padrón (§8.7).
 *
 *   pnpm roles:renormalize
 *
 * Correr una vez después de desplegar un cambio de `normalizeAddress`. Es idempotente.
 */
import './_env';
import { db, sqlClient } from '@/db/client';
import { renormalizeRoleAddresses } from '@/server/services/roles';

async function main() {
  const started = Date.now();
  const { total, changed } = await renormalizeRoleAddresses(db);
  console.log(`Roles con dirección: ${total}`);
  console.log(`Roles actualizados: ${changed}`);
  console.log(`Listo en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await sqlClient.end();
}

main().catch((err) => {
  console.error('Error al recalcular las direcciones:', err);
  process.exit(1);
});
