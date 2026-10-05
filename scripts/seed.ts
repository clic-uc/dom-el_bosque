import './_env';
import { db, sqlClient } from '@/db/client';
import { seedLayers } from '@/db/seed';

async function main() {
  const summary = await seedLayers(db);
  console.log(`Capas creadas: ${summary.created.length}${summary.created.length ? ` (${summary.created.join(', ')})` : ''}`);
  console.log(`Capas actualizadas: ${summary.updated.length}${summary.updated.length ? ` (${summary.updated.join(', ')})` : ''}`);
  console.log(`Sin cambios: ${summary.unchanged.length}`);
  await sqlClient.end();
}

main().catch((err) => {
  console.error('Error en el seed:', err);
  process.exit(1);
});
