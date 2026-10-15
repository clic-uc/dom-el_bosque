/**
 * Importa el padrón de roles (§7.4 / §11).
 *
 *   pnpm roles:import ruta/roles.csv
 *   pnpm roles:renormalize          (= roles:import --renormalize)
 *
 * CSV con `;` y cabeceras `roleId;DIRECCION;COMPLEMENTO;lat;lon` (~42.600 filas). No se versiona.
 * `--renormalize` no lee ningún CSV: recalcula la dirección normalizada del padrón ya cargado. Se corre una
 * vez después de desplegar un cambio de `normalizeAddress`, y es idempotente.
 */
import './_env';
import { readFile } from 'node:fs/promises';
import { db, sqlClient } from '@/db/client';
import { importRoleCoordinates, renormalizeRoleAddresses } from '@/server/services/roles';

async function renormalize() {
  const started = Date.now();
  const { total, changed } = await renormalizeRoleAddresses(db);
  console.log(`Roles con dirección: ${total}`);
  console.log(`Roles actualizados: ${changed}`);
  console.log(`Listo en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await sqlClient.end();
}

async function main() {
  if (process.argv[2] === '--renormalize') return renormalize();
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
