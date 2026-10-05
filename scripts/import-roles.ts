/**
 * Importa el padrón de roles (§7.4 / §11).
 *
 *   pnpm roles:import ruta/roles.csv
 *
 * CSV con `;` y cabeceras `roleId;DIRECCION;COMPLEMENTO;lat;lon` (~42.600 filas). No se versiona.
 */
import './_env';
import { readFile } from 'node:fs/promises';
import { db, sqlClient } from '@/db/client';
import { importRoleCoordinates } from '@/server/services/roles';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: pnpm roles:import <ruta/roles.csv>');
    process.exit(1);
  }
  const buffer = await readFile(file);
  const started = Date.now();
  const summary = await importRoleCoordinates(db, { userId: 'cli', email: 'cli@sigdom' }, buffer, { fileName: file });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Filas leídas: ${summary.totalRows}`);
  console.log(`Roles creados/actualizados: ${summary.upsertedRoles}`);
  console.log(`Registros reubicados: ${summary.updatedRecords}`);
  console.log(`Filas inválidas: ${summary.invalidRows.length}`);
  for (const r of summary.invalidRows.slice(0, 10)) console.log(`  fila ${r.rowNumber}: ${r.message}`);
  if (summary.missingFromPadron.length) {
    console.log(
      `Roles vigentes en el sistema que no vienen en el padrón: ${summary.missingFromPadron.length} (posibles operaciones pendientes)`,
    );
  }
  console.log(`Listo en ${secs} s`);
  await sqlClient.end();
}

main().catch((err) => {
  console.error('Error al importar el padrón:', err);
  process.exit(1);
});
