import './_env';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  console.log(`Aplicando migraciones desde ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log('Migraciones aplicadas.');
  await sql.end();
}

main().catch((err) => {
  console.error('Error al migrar:', err);
  process.exit(1);
});
