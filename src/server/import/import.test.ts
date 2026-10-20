/**
 * Flujo completo de importación contra BD real (fase 7, criterios de aceptación):
 *   XLSX de 10k filas con títulos arriba, errores, duplicados (BD y archivo) y direcciones sin coordenadas
 *   → análisis < 20 s → corrección por celda → omitir duplicados en bloque → confirmar → CSV de errores → revertir.
 *
 *   DATABASE_URL=postgres://postgres:password@localhost:5432/sigdom_test_c pnpm vitest run src/server/import
 */
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { importRows, imports, records } from '@/db/schema';
import { ConflictError } from '../errors';
import {
  createLayer,
  createRole,
  db,
  editor,
  field,
  insertRecord,
  setupDbSuite,
  truncateAll,
} from '../services/__tests__/helpers';
import { csvBuffer, fakeFile, roleOf, xlsxBuffer, type Cell } from './__tests__/fixtures';
import { runAnalyze, startAnalyze } from './analyze';
import { runCommit, startCommit } from './commit';
import { buildErrorsCsv } from './errors-csv';
import { bulkRows, getStatus, listRows, patchRow } from './review';
import { revertImport } from './revert';
import { uploadImport } from './upload';

vi.mock('@/server/jobs/boss', () => ({
  enqueue: vi.fn(async () => null),
  queues: {
    importAnalyze: 'import.analyze',
    importCommit: 'import.commit',
    importGeocodeExternal: 'import.geocode-external',
    importCleanup: 'import.cleanup',
    ping: 'system.ping',
  },
}));

import { enqueue } from '../jobs/boss';
const enqueueMock = vi.mocked(enqueue);

setupDbSuite({ truncate: false });

const HEADERS = ['Rol SII', 'N° Permiso', 'Dirección', 'Fecha', 'Monto', 'Propietario', 'Observaciones'];
const N = 10_000;
const ROLE_POOL = 200;
const DB_DUPS = 50;
const FILE_DUPS = 50;
const BAD_ROLES = 50;
const BAD_DATES = 50;
const EXACT_ADDR = 100;
const UNKNOWN_ADDR = 200;
const FIRST_DATA_ROW = 4; // 2 filas de título + encabezados en la fila 3

function buildRows(): Cell[][] {
  const rows: Cell[][] = [];
  const date = new Date(Date.UTC(2024, 0, 15));
  for (let i = 0; i < N; i++) {
    if (i < N - DB_DUPS - FILE_DUPS - BAD_ROLES - BAD_DATES - EXACT_ADDR - UNKNOWN_ADDR) {
      rows.push([
        roleOf(100_000 + (i % ROLE_POOL)),
        i + 1,
        `Calle Falsa ${i + 1}`,
        date,
        1000 + i,
        `Vecino ${i}`,
        i % 10 === 0 ? 'ok' : null,
      ]);
    } else if (i < N - FILE_DUPS - BAD_ROLES - BAD_DATES - EXACT_ADDR - UNKNOWN_ADDR) {
      const k = i - (N - DB_DUPS - FILE_DUPS - BAD_ROLES - BAD_DATES - EXACT_ADDR - UNKNOWN_ADDR);
      // duplicado contra la BD: mismo rol y mismo N° Permiso que un registro existente; propietario vacío
      rows.push([roleOf(100_000 + k), 900_001 + k, `Calle Falsa ${k}`, date, 5555, null, null]);
    } else if (i < N - BAD_ROLES - BAD_DATES - EXACT_ADDR - UNKNOWN_ADDR) {
      const k = i - (N - FILE_DUPS - BAD_ROLES - BAD_DATES - EXACT_ADDR - UNKNOWN_ADDR);
      // duplicado dentro del archivo: repite la fila k
      rows.push([
        roleOf(100_000 + (k % ROLE_POOL)),
        k + 1,
        `Calle Falsa ${k + 1}`,
        date,
        1,
        'Repetido',
        null,
      ]);
    } else if (i < N - BAD_DATES - EXACT_ADDR - UNKNOWN_ADDR) {
      rows.push(['abc', 700_000 + i, 'Calle Falsa 1', date, 1, 'Rol malo', null]);
    } else if (i < N - EXACT_ADDR - UNKNOWN_ADDR) {
      rows.push([roleOf(100_050), 700_000 + i, 'Calle Falsa 1', 'no es fecha', 1, 'Fecha mala', null]);
    } else if (i < N - UNKNOWN_ADDR) {
      const k = i - (N - EXACT_ADDR - UNKNOWN_ADDR);
      // sin rol, con dirección exacta del padrón → rol asignado por dirección
      rows.push([null, 700_000 + i, `Alejandro Guzmán ${1001 + k}`, date, 1, 'Por dirección', null]);
    } else {
      // sin rol, dirección desconocida → geocodificación externa pendiente
      rows.push([null, 700_000 + i, `Pasaje Inexistente ${i}`, date, 1, 'Sin ubicación', null]);
    }
  }
  return rows;
}

describe('Importación en dos fases: flujo completo con XLSX de 10k filas', () => {
  let layerId = 0;
  let importId = '';
  let dupTargetId = 0;
  let dupRowNumber = 0;

  beforeAll(async () => {
    await truncateAll();
    enqueueMock.mockClear();
    const layer = await createLayer({
      name: 'Obras Menores',
      hasRole: true,
      fields: [
        field('n_permiso', 'N° Permiso', 'number', { required: true }),
        field('direccion', 'Dirección'),
        field('fecha', 'Fecha', 'date'),
        field('monto', 'Monto', 'number'),
        field('propietario', 'Propietario'),
      ],
      uniqueKeys: ['n_permiso'],
      addressFieldKey: 'direccion',
    });
    layerId = layer.id;
    // padrón: 200 roles con coordenadas, 100 direcciones exactas
    for (let k = 0; k < ROLE_POOL; k++) {
      await createRole(roleOf(100_000 + k), { lat: -33.56 - k * 0.00001, lon: -70.66 });
    }
    for (let k = 0; k < EXACT_ADDR; k++) {
      await createRole(roleOf(200_000 + k), {
        lat: -33.561,
        lon: -70.662,
        address: `ALEJANDRO GUZMAN ${1001 + k}`,
      });
    }
    // 50 registros existentes que el archivo repite
    for (let k = 0; k < DB_DUPS; k++) {
      const r = await insertRecord({
        layerId,
        roleId: roleOf(100_000 + k),
        attributes: { n_permiso: 900_001 + k, propietario: 'Dueño original', monto: 1 },
      });
      if (k === 0) dupTargetId = r.id;
    }
  }, 120_000);

  it('sube el XLSX, detecta la fila de encabezados y sugiere el mapeo', async () => {
    const buf = await xlsxBuffer(HEADERS, buildRows());
    const source = await uploadImport(db, editor, layerId, fakeFile('permisos.xlsx', buf));
    importId = source.importId;
    expect(source.fileType).toBe('xlsx');
    expect(source.sheets).toEqual(['Datos', 'Resumen']);
    expect(source.headerRow).toBe(3);
    expect(source.totalRows).toBe(N);
    expect(source.preview).toHaveLength(20);
    expect(source.preview[0]!.rowNumber).toBe(FIRST_DATA_ROW);
    expect(source.suggestedMapping).toEqual({
      'Rol SII': 'roleId',
      'N° Permiso': 'n_permiso',
      Dirección: 'direccion',
      Fecha: 'fecha',
      Monto: 'monto',
      Propietario: 'propietario',
      Observaciones: 'comments',
    });
  }, 60_000);

  it('analiza 10k filas en menos de 20 s con errores, duplicados y direcciones', async () => {
    await startAnalyze(db, editor, importId, {
      columnMapping: {
        'Rol SII': 'roleId',
        'N° Permiso': 'n_permiso',
        Dirección: 'direccion',
        Fecha: 'fecha',
        Monto: 'monto',
        Propietario: 'propietario',
        Observaciones: 'comments',
      },
      duplicateStrategy: 'ask',
      keepExistingOnEmpty: true,
      geocode: true,
      fullReplace: false,
    });
    expect(enqueueMock).toHaveBeenCalledWith('import.analyze', { importId });
    const [queued] = await db
      .select({ status: imports.status })
      .from(imports)
      .where(eq(imports.id, importId));
    expect(queued!.status).toBe('ANALYZING');

    enqueueMock.mockClear();
    const t0 = performance.now();
    await runAnalyze(db, importId);
    const elapsed = performance.now() - t0;
    console.warn(`[perf] análisis de ${N} filas: ${(elapsed / 1000).toFixed(1)} s`);
    const status = await getStatus(db, importId);
    expect(status.status).toBe('REVIEW');
    expect(status.errorMessage).toBeNull();
    expect(status.totalRows).toBe(N);
    expect(status.counts.error).toBe(BAD_ROLES + BAD_DATES);
    expect(status.counts.duplicate).toBe(DB_DUPS + FILE_DUPS);
    expect(status.counts.unresolvedDuplicates).toBe(DB_DUPS + FILE_DUPS);
    expect(status.counts.valid + status.counts.warning).toBe(N - BAD_ROLES - BAD_DATES - DB_DUPS - FILE_DUPS);
    expect(status.codeCounts.role_invalid).toBe(BAD_ROLES);
    expect(status.codeCounts.type_invalid).toBe(BAD_DATES);
    expect(status.codeCounts.duplicate_existing).toBe(DB_DUPS);
    expect(status.codeCounts.duplicate_in_file).toBe(FILE_DUPS);
    expect(status.codeCounts.role_assigned_by_address).toBe(EXACT_ADDR);
    // las filas con rol inválido tampoco tienen rol: su dirección también queda pendiente
    expect(status.codeCounts.location_pending).toBe(UNKNOWN_ADDR + BAD_ROLES);
    expect(status.pendingGeocode).toBe(UNKNOWN_ADDR + BAD_ROLES);
    expect(enqueueMock).toHaveBeenCalledTimes(UNKNOWN_ADDR + BAD_ROLES);
    expect(enqueueMock).toHaveBeenCalledWith('import.geocode-external', {
      importId,
      rowNumber: N + FIRST_DATA_ROW - 1,
    });

    // los roles sin coordenadas en el padrón: filas con 'own'? no traen coordenadas → sin ubicación o geocodificadas
    const page = await listRows(db, importId, {
      status: 'error',
      code: 'role_invalid',
      page: 1,
      pageSize: 5,
    });
    expect(page.total).toBe(BAD_ROLES);
    expect(page.data[0]!.messages[0]!.message).toMatch(/Rol "abc"/);

    const dups = await listRows(db, importId, { code: 'duplicate_existing', page: 1, pageSize: 1 });
    expect(dups.data[0]!.duplicateOf).toEqual([dupTargetId]);
    expect(dups.data[0]!.existing?.[0]).toMatchObject({
      id: dupTargetId,
      attributes: { propietario: 'Dueño original' },
    });
    dupRowNumber = dups.data[0]!.rowNumber;
    expect(elapsed).toBeLessThan(20_000);
  }, 90_000);

  it('corregir una celda revalida la fila sola', async () => {
    const badRole = await listRows(db, importId, { code: 'role_invalid', page: 1, pageSize: 1 });
    const row = badRole.data[0]!;
    const fixed = await patchRow(db, editor, importId, row.rowNumber, {
      raw: { 'Rol SII': roleOf(100_050) },
    });
    expect(fixed.status).toBe('valid');
    expect(fixed.parsed?.roleId).toBe(roleOf(100_050));
    expect(fixed.parsed?.coordsSource).toBe('role');
    expect(fixed.messages.some((m) => m.level === 'error')).toBe(false);

    const badDate = await listRows(db, importId, { code: 'type_invalid', page: 1, pageSize: 1 });
    const fixedDate = await patchRow(db, editor, importId, badDate.data[0]!.rowNumber, {
      raw: { Fecha: '31/02/2024' },
    });
    expect(fixedDate.status).toBe('error');
    expect(fixedDate.messages[0]!.message).toMatch(/no es una fecha válida \(usa dd-mm-aaaa\)/);
    const fixedDate2 = await patchRow(db, editor, importId, badDate.data[0]!.rowNumber, {
      raw: { Fecha: '12/03/2024' },
    });
    expect(fixedDate2.status).toBe('valid');
    expect(fixedDate2.parsed?.attributes.fecha).toBe('2024-03-12');

    const status = await getStatus(db, importId);
    expect(status.counts.error).toBe(BAD_ROLES + BAD_DATES - 2);
  });

  it('no deja confirmar con duplicados sin resolver y "omitir todos" en bloque los resuelve', async () => {
    await expect(startCommit(db, editor, importId, { acceptPendingGeocode: true })).rejects.toThrow(
      ConflictError,
    );

    const res = await bulkRows(db, editor, importId, { filter: { status: 'duplicate' }, action: 'skip' });
    expect(res.updated).toBe(DB_DUPS + FILE_DUPS);
    const status = await getStatus(db, importId);
    expect(status.counts.unresolvedDuplicates).toBe(0);

    // uno de los duplicados contra la BD se actualiza en vez de omitirse
    const row = await patchRow(db, editor, importId, dupRowNumber, { resolution: 'update' });
    expect(row.resolution).toBe('update');
    expect(row.updateTargetId).toBe(dupTargetId);

    // excluir una fila con error la saca del conteo de fallidas
    const bad = await listRows(db, importId, { status: 'error', page: 1, pageSize: 1 });
    const excluded = await patchRow(db, editor, importId, bad.data[0]!.rowNumber, { excluded: true });
    expect(excluded.status).toBe('excluded');
  });

  it('exige aceptar las direcciones pendientes y luego confirma en menos de 60 s', async () => {
    await expect(startCommit(db, editor, importId, { acceptPendingGeocode: false })).rejects.toThrow(
      /OpenStreetMap/,
    );
    await startCommit(db, editor, importId, { acceptPendingGeocode: true });
    expect(enqueueMock).toHaveBeenCalledWith('import.commit', { importId });

    const t0 = performance.now();
    await runCommit(db, importId);
    const elapsed = performance.now() - t0;
    console.warn(`[perf] confirmación de ${N} filas: ${(elapsed / 1000).toFixed(1)} s`);
    expect(elapsed).toBeLessThan(60_000);

    const status = await getStatus(db, importId);
    expect(status.status).toBe('COMPLETED');
    const failed = BAD_ROLES + BAD_DATES - 2 - 1; // 2 corregidas, 1 excluida
    const skipped = DB_DUPS + FILE_DUPS - 1 + 1; // 1 pasó a actualizar, 1 excluida
    expect(status.failedCount).toBe(failed);
    expect(status.skippedCount).toBe(skipped);
    expect(status.updatedCount).toBe(1);
    expect(status.createdCount).toBe(N - failed - skipped - 1);
    expect(status).not.toHaveProperty('fileKey');
    const [row] = await db.select({ fileKey: imports.fileKey }).from(imports).where(eq(imports.id, importId));
    expect(row!.fileKey).toBeNull();

    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(records)
      .where(eq(records.layerId, layerId));
    expect(Number(cnt!.n)).toBe(DB_DUPS + status.createdCount);

    // actualizado en el lugar: conserva id y el propietario (celda vacía no borra), cambia el monto
    const [updated] = await db.select().from(records).where(eq(records.id, dupTargetId));
    expect(updated!.attributes).toMatchObject({
      propietario: 'Dueño original',
      monto: 5555,
      n_permiso: 900_001,
    });

    // filas sin rol y con dirección exacta → rol asignado y coordenadas del rol
    const byAddress = await db
      .select({ roleId: records.roleId, coordsSource: records.coordsSource })
      .from(records)
      .where(and(eq(records.layerId, layerId), sql`${records.attributes}->>'propietario' = 'Por dirección'`));
    expect(byAddress).toHaveLength(EXACT_ADDR);
    expect(byAddress.every((r) => r.roleId?.startsWith('00002-') && r.coordsSource === 'role')).toBe(true);

    // pendientes de OSM: importadas sin ubicación
    const pending = await db
      .select({ lat: records.lat })
      .from(records)
      .where(and(eq(records.layerId, layerId), sql`${records.attributes}->>'propietario' = 'Sin ubicación'`));
    expect(pending).toHaveLength(UNKNOWN_ADDR);
    expect(pending.every((r) => r.lat === null)).toBe(true);

    // comentarios mapeados
    const [withComment] = await db
      .select({ comments: records.comments })
      .from(records)
      .where(and(eq(records.layerId, layerId), sql`${records.attributes}->>'n_permiso' = '1'`));
    expect(withComment!.comments).toBe('ok');

    // el rol sin coordenadas en el padrón no adopta nada (las filas no traían coordenadas propias)
    const linked = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(and(eq(importRows.importId, importId), sql`${importRows.recordId} IS NOT NULL`));
    expect(Number(linked[0]!.n)).toBe(status.createdCount + 1);
  }, 120_000);

  it('el CSV de errores contiene exactamente las filas fallidas', async () => {
    const { csv, count } = await buildErrorsCsv(db, importId);
    const failedRows = await db
      .select({ rowNumber: importRows.rowNumber })
      .from(importRows)
      .where(and(eq(importRows.importId, importId), eq(importRows.status, 'error')))
      .orderBy(importRows.rowNumber);
    expect(count).toBe(failedRows.length);
    expect(count).toBe(BAD_ROLES + BAD_DATES - 3);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(['Fila', ...HEADERS, 'Error'].join(';'));
    expect(lines).toHaveLength(count + 1);
    expect(lines.slice(1).map((l) => Number(l.split(';')[0]))).toEqual(failedRows.map((r) => r.rowNumber));
    expect(lines[1]).toMatch(/Rol ""abc""/);
  });

  it('revertir borra los creados y restaura los actualizados', async () => {
    const other = { ...editor, userId: 'otro' };
    await expect(revertImport(db, other, importId, { force: false })).rejects.toThrow(
      /otra persona|administrador/,
    );

    const t0 = performance.now();
    const result = await revertImport(db, editor, importId, { force: false });
    console.warn(`[perf] reversión de ${N} filas: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    const status = await getStatus(db, importId);
    expect(status.status).toBe('REVERTED');
    expect(result.restoredRecords).toBe(1);
    expect(result.deletedRecords).toBe(status.createdCount);
    expect(result.reinsertedRecords).toBe(0);

    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(records)
      .where(eq(records.layerId, layerId));
    expect(Number(cnt!.n)).toBe(DB_DUPS);
    const [restored] = await db.select().from(records).where(eq(records.id, dupTargetId));
    expect(restored!.attributes).toEqual({ n_permiso: 900_001, propietario: 'Dueño original', monto: 1 });

    await expect(revertImport(db, editor, importId, { force: false })).rejects.toThrow(/ya fue revertida/);
  }, 300_000);

  it('revertir avisa si hubo cambios posteriores y solo sigue con force', async () => {
    const buf = csvBuffer(['Rol SII', 'N° Permiso'], [[roleOf(100_001), 123_456]]);
    const source = await uploadImport(db, editor, layerId, fakeFile('uno.csv', buf));
    await startAnalyze(db, editor, source.importId, {
      columnMapping: { 'Rol SII': 'roleId', 'N° Permiso': 'n_permiso' },
      duplicateStrategy: 'ask',
      keepExistingOnEmpty: true,
      geocode: false,
      fullReplace: false,
    });
    await runAnalyze(db, source.importId);
    await startCommit(db, editor, source.importId, { acceptPendingGeocode: false });
    await runCommit(db, source.importId);
    const [row] = await db
      .select({ recordId: importRows.recordId })
      .from(importRows)
      .where(eq(importRows.importId, source.importId));
    await db
      .update(records)
      .set({ comments: 'editado después', updatedAt: sql`now() + interval '1 second'` })
      .where(eq(records.id, row!.recordId!));

    await expect(revertImport(db, editor, source.importId, { force: false })).rejects.toThrow(
      /modificado después/,
    );
    const result = await revertImport(db, editor, source.importId, { force: true });
    expect(result.deletedRecords).toBe(1);
  });
});
