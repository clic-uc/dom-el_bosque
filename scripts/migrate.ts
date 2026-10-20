/**
 * Aplica las migraciones pendientes y luego recalcula la dirección normalizada del padrón de roles.
 *
 *   pnpm db:migrate              (producción: `node scripts/migrate.js` en entrypoint.sh, en cada arranque de `app`)
 *
 * El recálculo (`renormalizeRoleAddresses`) mantiene el padrón guardado al día con la `normalizeAddress` del código
 * desplegado: es idempotente, solo escribe los roles que cambian y con el padrón vacío no hace nada.
 */
import './_env';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { renormalizeRoleAddresses } from '@/server/services/roles';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  console.log(`Aplicando migraciones desde ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log('Migraciones aplicadas.');

  const { total, changed } = await renormalizeRoleAddresses(db, { userId: 'cli', email: 'cli@sigdom' });
  console.log(`Direcciones del padrón revisadas: ${total}; recalculadas: ${changed}.`);
  await sql.end();
}

main().catch((err) => {
  console.error('Error al migrar:', err);
  process.exit(1);
});
