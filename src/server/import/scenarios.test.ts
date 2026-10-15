/**
 * Escenarios puntuales de importación contra BD real (fase 7): reemplazo completo con adjuntos/correlativos y
 * reversión con ids originales, correlativos históricos, rol por dirección exacta, rol no vigente, CSV Windows-1252,
 * cola de geocodificación externa con proveedor falso, descartar, cambiar hoja y limpieza de borradores vencidos.
 */
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  attachments,
  importRemovals,
  importRows,
  imports,
  layerCounters,
  records,
  roleOperationRoles,
  roleOperations,
} from '@/db/schema';
import type { Actor } from '../auth/session';
import { ConflictError, ForbiddenError } from '../errors';
import { createGeocoder } from '../geocoding';
import type { GeocodeProvider } from '../geocoding/providers/types';
import {
  createLayer,
  createRole,
  db,
  editor,
  field,
  insertRecord,
  setupDbSuite,
} from '../services/__tests__/helpers';
import { previewNextNumber } from '../services/numbering';
import { storage } from '../storage';
import { csvBuffer, fakeFile, roleOf, xlsxBuffer, type Cell } from './__tests__/fixtures';
import { runAnalyze, startAnalyze } from './analyze';
import { cleanupExpiredImports } from './cleanup';
import { runCommit, startCommit } from './commit';
import { runGeocodeExternal } from './geocode-external';
import {
  bulkRows,
  discardImport,
  getStatus,
  listRemovals,
  listRows,
  patchRemovals,
  patchRow,
} from './review';
import { revertImport } from './revert';
import { listImports } from './service';
import { patchImportSource, uploadImport } from './upload';

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

setupDbSuite();

const admin: Actor = {
  userId: 'adm',
  email: 'adm@t',
  name: 'Admin',
  role: 'admin',
  rawRole: 'admin',
  mustChangePassword: false,
};

const baseFields = () => [
  field('n_permiso', 'N° Permiso', 'number', { required: true }),
  field('direccion', 'Dirección'),
  field('propietario', 'Propietario'),
];

type MappingInput = Parameters<typeof startAnalyze>[3];
const analyzeInput = (
  columnMapping: Record<string, string | null>,
  extra: Partial<MappingInput> = {},
): MappingInput => ({
  columnMapping,
  duplicateStrategy: 'ask',
  keepExistingOnEmpty: true,
  geocode: true,
  fullReplace: false,
  ...extra,
});

/** Sube, analiza y devuelve el importId (sin confirmar). */
async function uploadAndAnalyze(
  layerId: number,
  name: string,
  buf: Buffer,
  input: MappingInput,
  actor = editor,
) {
  const source = await uploadImport(db, actor, layerId, fakeFile(name, buf));
  await startAnalyze(db, actor, source.importId, input);
  await runAnalyze(db, source.importId);
  return source.importId;
}

async function commit(importId: string, actor = editor) {
  await startCommit(db, actor, importId, { acceptPendingGeocode: true });
  await runCommit(db, importId);
  return getStatus(db, importId);
}

describe('Reemplazo completo (§8.5 paso 4)', () => {
  it('actualiza conservando id y adjuntos, lista los que faltan, protege adjuntos y correlativos y revierte con el id original', async () => {
    const layer = await createLayer({ hasRole: true, fields: baseFields(), uniqueKeys: ['n_permiso'] });
    await createRole(roleOf(1), { lat: -33.56, lon: -70.66 });
    await createRole(roleOf(2), { lat: -33.56, lon: -70.66 });
    await createRole(roleOf(3));
    await createRole(roleOf(4));
    await createRole(roleOf(5));

    const keep = await insertRecord({
      layerId: layer.id,
      roleId: roleOf(1),
      attributes: { n_permiso: 1, propietario: 'Uno' },
      lat: -33.561,
      lon: -70.661,
      coordsSource: 'own',
      comments: 'nota',
    });
    const withAttachment = await insertRecord({
      layerId: layer.id,
      roleId: roleOf(2),
      attributes: { n_permiso: 2, propietario: 'Dos' },
    });
    await db.insert(attachments).values({
      entityType: 'record',
      entityId: String(withAttachment.id),
      kind: 'link',
      title: 'Plano',
      url: 'https://x',
    });
    const numbered = await insertRecord({
      layerId: layer.id,
      roleId: roleOf(3),
      attributes: { n_permiso: 3 },
      numberAssignedAt: new Date(),
    });
    const platform = await insertRecord({
      layerId: layer.id,
      roleId: roleOf(4),
      attributes: { n_permiso: 4, propietario: 'Cuatro' },
    });
    // registro que viene de una importación anterior (import_rows.record_id)
    const imported = await insertRecord({
      layerId: layer.id,
      roleId: roleOf(5),
      attributes: { n_permiso: 5 },
    });
    const [prev] = await db
      .insert(imports)
      .values({
        layerId: layer.id,
        userId: 'x',
        fileName: 'anterior.csv',
        fileType: 'csv',
        status: 'COMPLETED',
      })
      .returning();
    await db.insert(importRows).values({
      importId: prev!.id,
      rowNumber: 2,
      raw: {},
      status: 'valid',
      recordId: imported.id,
      action: 'created',
    });

    // el archivo trae solo el registro 1 (con otro propietario y sin comentarios) y uno nuevo
    const buf = csvBuffer(
      ['Rol', 'N° Permiso', 'Propietario'],
      [
        [roleOf(1), 1, 'Uno corregido'],
        [roleOf(1), 99, 'Nuevo'],
      ],
    );
    const id = await uploadAndAnalyze(
      layer.id,
      'completa.csv',
      buf,
      analyzeInput(
        { Rol: 'roleId', 'N° Permiso': 'n_permiso', Propietario: 'propietario' },
        { fullReplace: true },
      ),
    );

    const status = await getStatus(db, id);
    expect(status.status).toBe('REVIEW');
    expect(status.duplicateStrategy).toBe('update');
    expect(status.counts.duplicate).toBe(1);
    expect(status.counts.unresolvedDuplicates).toBe(0);
    expect(status.removals).toEqual({ total: 4, toDelete: 0, notDeletable: 2 });

    const removals = await listRemovals(db, id, { page: 1, pageSize: 50 });
    const byRecord = new Map(removals.data.map((r) => [r.recordId, r]));
    expect(byRecord.get(withAttachment.id)).toMatchObject({
      deletable: false,
      reason: 'Tiene documentos adjuntos',
    });
    expect(byRecord.get(numbered.id)).toMatchObject({
      deletable: false,
      reason: expect.stringMatching(/correlativo/),
    });
    expect(byRecord.get(platform.id)).toMatchObject({
      deletable: true,
      reason: expect.stringMatching(/Creado en la plataforma/),
    });
    expect(byRecord.get(imported.id)).toMatchObject({ deletable: true, reason: null });
    expect(byRecord.get(platform.id)!.record?.summary[0]).toEqual({ label: 'N° Permiso', value: '4' });

    // "eliminar todos" ignora los no borrables
    const marked = await patchRemovals(db, editor, id, { all: true, resolution: 'delete' });
    expect(marked.updated).toBe(2);
    expect((await getStatus(db, id)).removals).toEqual({ total: 4, toDelete: 2, notDeletable: 2 });

    const done = await commit(id);
    expect(done.status).toBe('COMPLETED');
    expect(done).toMatchObject({
      createdCount: 1,
      updatedCount: 1,
      deletedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    });

    const [kept] = await db.select().from(records).where(eq(records.id, keep.id));
    expect(kept).toMatchObject({ id: keep.id, comments: 'nota', lat: -33.561, coordsSource: 'own' });
    expect(kept!.attributes).toEqual({ n_permiso: 1, propietario: 'Uno corregido' });
    expect(await db.select().from(records).where(eq(records.id, withAttachment.id))).toHaveLength(1);
    expect(await db.select().from(records).where(eq(records.id, numbered.id))).toHaveLength(1);
    expect(await db.select().from(records).where(eq(records.id, platform.id))).toHaveLength(0);
    expect(await db.select().from(records).where(eq(records.id, imported.id))).toHaveLength(0);
    const deletedRows = await db
      .select()
      .from(importRemovals)
      .where(and(eq(importRemovals.importId, id), eq(importRemovals.deleted, true)));
    expect(deletedRows.map((r) => r.recordId).sort()).toEqual([platform.id, imported.id].sort());
    expect(deletedRows[0]!.snapshot).toBeTruthy();

    // revertir: vuelve el propietario, borra el nuevo y reinserta los borrados con su id original
    const result = await revertImport(db, editor, id, { force: false });
    expect(result).toEqual({ deletedRecords: 1, restoredRecords: 1, reinsertedRecords: 2 });
    const [restored] = await db.select().from(records).where(eq(records.id, keep.id));
    expect(restored!.attributes).toEqual({ n_permiso: 1, propietario: 'Uno' });
    const [back] = await db.select().from(records).where(eq(records.id, platform.id));
    expect(back).toMatchObject({
      id: platform.id,
      roleId: roleOf(4),
      attributes: { n_permiso: 4, propietario: 'Cuatro' },
      createdBy: 't',
    });
    // la secuencia sigue después del mayor id
    const fresh = await insertRecord({ layerId: layer.id, attributes: { n_permiso: 1000 } });
    expect(fresh.id).toBeGreaterThan(Math.max(platform.id, imported.id, keep.id));
  });

  it('no se permite sin campos únicos', async () => {
    const layer = await createLayer({ hasRole: true, fields: baseFields(), uniqueKeys: [] });
    const source = await uploadImport(
      db,
      editor,
      layer.id,
      fakeFile('a.csv', csvBuffer(['Rol', 'N° Permiso'], [[roleOf(1), 1]])),
    );
    await expect(
      startAnalyze(
        db,
        editor,
        source.importId,
        analyzeInput({ Rol: 'roleId', 'N° Permiso': 'n_permiso' }, { fullReplace: true }),
      ),
    ).rejects.toThrow(/campos únicos/);
  });
});

describe('Correlativos históricos (§8.5 paso 6 / §8.8)', () => {
  it('importa los números tal cual y el próximo es max + 1; un valor no entero es error', async () => {
    const layer = await createLayer({
      hasRole: true,
      fields: [
        field('n_permiso', 'N° Permiso', 'autonumber', { options: { reset: 'never' } }),
        field('propietario', 'Propietario'),
      ],
      uniqueKeys: ['n_permiso'],
    });
    await createRole(roleOf(1), { lat: -33.56, lon: -70.66 });
    const rows: Cell[][] = [];
    for (let n = 1; n <= 100; n++) rows.push([roleOf(1), n, `P${n}`]);
    rows.push([roleOf(1), 6123, 'Último']);
    rows.push([roleOf(1), '12,5', 'Decimal']);
    rows.push([roleOf(1), 'abc', 'Texto']);
    const id = await uploadAndAnalyze(
      layer.id,
      'historico.csv',
      csvBuffer(['Rol', 'N° Permiso', 'Propietario'], rows),
      analyzeInput({ Rol: 'roleId', 'N° Permiso': 'n_permiso', Propietario: 'propietario' }),
    );
    const status = await getStatus(db, id);
    expect(status.counts.error).toBe(2);
    expect(status.codeCounts.autonumber_invalid).toBe(2);
    expect(status.nextNumber).toEqual({ fieldKey: 'n_permiso', label: 'N° Permiso', next: 1 });
    const done = await commit(id);
    expect(done).toMatchObject({ createdCount: 101, failedCount: 2 });
    expect(done.nextNumber?.next).toBe(6124);
    expect((await previewNextNumber(db, layer.id))?.next).toBe(6124);
    const counters = await db.select().from(layerCounters).where(eq(layerCounters.layerId, layer.id));
    expect(counters.every((c) => c.lastValue === 0)).toBe(true); // el contador no se toca
    const [last] = await db
      .select({ attributes: records.attributes })
      .from(records)
      .where(and(eq(records.layerId, layer.id), sql`${records.attributes}->>'propietario' = 'Último'`));
    expect(last!.attributes.n_permiso).toBe(6123);
  });

  it('al actualizar no pisa un número asignado por la plataforma', async () => {
    const layer = await createLayer({
      hasRole: true,
      fields: [
        field('n_permiso', 'N° Permiso', 'autonumber', { options: { reset: 'never' } }),
        field('rut', 'Rut'),
        field('propietario', 'Propietario'),
      ],
      uniqueKeys: ['rut'],
    });
    await createRole(roleOf(1));
    const rec = await insertRecord({
      layerId: layer.id,
      roleId: roleOf(1),
      attributes: { rut: '1-9', n_permiso: 50 },
      numberAssignedAt: new Date(),
    });
    const id = await uploadAndAnalyze(
      layer.id,
      'u.csv',
      csvBuffer(['Rol', 'Rut', 'N° Permiso', 'Propietario'], [[roleOf(1), '1-9', 7, 'Nuevo dueño']]),
      analyzeInput(
        { Rol: 'roleId', Rut: 'rut', 'N° Permiso': 'n_permiso', Propietario: 'propietario' },
        { duplicateStrategy: 'update' },
      ),
    );
    const done = await commit(id);
    expect(done.updatedCount).toBe(1);
    const [row] = await db.select().from(records).where(eq(records.id, rec.id));
    expect(row!.attributes).toMatchObject({ n_permiso: 50, propietario: 'Nuevo dueño' });
    expect(row!.numberAssignedAt).not.toBeNull();
  });
});

describe('Roles y direcciones', () => {
  it('asigna el rol por dirección exacta, sugiere por dirección parecida y advierte rol nuevo / no vigente', async () => {
    const layer = await createLayer({
      hasRole: true,
      fields: baseFields(),
      uniqueKeys: ['n_permiso'],
      addressFieldKey: 'direccion',
    });
    await createRole(roleOf(10), { lat: -33.561, lon: -70.662, address: 'ALEJANDRO GUZMAN 1015' });
    await createRole(roleOf(11), { lat: -33.562, lon: -70.663, address: 'RIQUELME 111 VILLA ITALIA' });
    await createRole(roleOf(20), { lat: -33.56, lon: -70.66, supersededAt: '2021-05-01' });
    await createRole(roleOf(21), { lat: -33.56, lon: -70.66 });
    await createRole(roleOf(22), { lat: -33.56, lon: -70.66 });
    const [op] = await db
      .insert(roleOperations)
      .values({ type: 'subdivision', effectiveDate: '2021-05-01', reference: 'Res. 1' })
      .returning();
    await db.insert(roleOperationRoles).values([
      { operationId: op!.id, roleId: roleOf(20), side: 'origin' },
      { operationId: op!.id, roleId: roleOf(21), side: 'result' },
      { operationId: op!.id, roleId: roleOf(22), side: 'result' },
    ]);

    const buf = csvBuffer(
      ['Rol', 'N° Permiso', 'Dirección'],
      [
        ['', 1, 'Alejandro Guzmán N° 1015, El Bosque'],
        ['', 2, 'Riquelme 111 Villa Italia Casa 2'],
        [roleOf(20), 3, ''],
        [roleOf(999), 4, ''],
        ['', 5, 'Avenida Padre Hurtado 9999'],
      ],
    );
    const id = await uploadAndAnalyze(
      layer.id,
      'dir.csv',
      buf,
      analyzeInput({ Rol: 'roleId', 'N° Permiso': 'n_permiso', Dirección: 'direccion' }),
    );
    const rows = (await listRows(db, id, { page: 1, pageSize: 50 })).data;
    const codes = (n: number) => rows[n]!.messages.map((m) => m.code);

    expect(rows[0]!.parsed).toMatchObject({ roleId: roleOf(10), coordsSource: 'role', lat: -33.561 });
    expect(codes(0)).toContain('role_assigned_by_address');

    // "Riquelme 111 Villa Italia Casa 2" → misma calle y número: exacto también
    expect(rows[1]!.parsed?.roleId).toBe(roleOf(11));

    expect(codes(2)).toContain('role_superseded');
    const sup = rows[2]!.messages.find((m) => m.code === 'role_superseded')!;
    expect(sup.data?.resultRoleIds).toEqual([roleOf(21), roleOf(22)]);
    expect(sup.message).toMatch(/ya no está vigente/);
    expect(rows[2]!.status).toBe('warning');

    expect(codes(3)).toContain('role_new');
    expect(rows[3]!.status).toBe('warning');

    expect(codes(4)).toContain('location_pending');
    expect(rows[4]!.parsed?.lat).toBeNull();

    // fijar rol a mano en una fila sin columna de rol válida y aceptar un rol resultante
    const fixed = await patchRow(db, editor, id, rows[2]!.rowNumber, { roleId: roleOf(21) });
    expect(fixed.parsed?.roleId).toBe(roleOf(21));
    expect(fixed.messages.map((m) => m.code)).not.toContain('role_superseded');

    // ubicación fijada a mano → 'own'
    const own = await patchRow(db, editor, id, rows[4]!.rowNumber, { lat: -33.565, lon: -70.67 });
    expect(own.parsed).toMatchObject({ lat: -33.565, lon: -70.67, coordsSource: 'own' });
    expect(own.messages.map((m) => m.code)).not.toContain('location_pending');
    expect(own.raw.__lat).toBe('-33.565');
  });

  it('informa cuántos registros tiene el rol en la capa cuando no hay campos únicos', async () => {
    const layer = await createLayer({ hasRole: true, fields: baseFields(), uniqueKeys: [] });
    await createRole(roleOf(1), { lat: -33.56, lon: -70.66 });
    await insertRecord({ layerId: layer.id, roleId: roleOf(1), attributes: { n_permiso: 1 } });
    await insertRecord({ layerId: layer.id, roleId: roleOf(1), attributes: { n_permiso: 2 } });
    const id = await uploadAndAnalyze(
      layer.id,
      'r.csv',
      csvBuffer(['Rol', 'N° Permiso'], [[roleOf(1), 1]]),
      analyzeInput({ Rol: 'roleId', 'N° Permiso': 'n_permiso' }),
    );
    const [row] = (await listRows(db, id, { page: 1, pageSize: 1 })).data;
    expect(row!.status).toBe('valid');
    expect(row!.messages).toEqual([
      expect.objectContaining({
        level: 'info',
        code: 'role_has_records',
        message: expect.stringMatching(/2 registros/),
      }),
    ]);
  });
});

describe('Geocodificación externa en segundo plano (§8.5 paso 5)', () => {
  it('actualiza la fila con el resultado externo, deja sugerencias para los aproximados y descuenta pendientes', async () => {
    const layer = await createLayer({
      hasRole: false,
      fields: baseFields(),
      uniqueKeys: ['n_permiso'],
      addressFieldKey: 'direccion',
    });
    const calls: string[] = [];
    const fake: GeocodeProvider = {
      name: 'nominatim',
      local: false,
      async geocode(address) {
        calls.push(address);
        if (address.includes('Exacta'))
          return {
            lat: -33.565,
            lon: -70.67,
            provider: 'nominatim',
            confidence: 'exact',
            label: 'Calle Exacta 1, El Bosque',
          };
        if (address.includes('Solo calle'))
          return {
            lat: -33.566,
            lon: -70.671,
            provider: 'nominatim',
            confidence: 'street',
            label: 'Solo calle',
          };
        return null;
      },
    };
    const geocoder = createGeocoder(db, {
      providers: ['padron', 'nominatim'],
      overrides: { nominatim: fake },
    });
    const buf = csvBuffer(
      ['N° Permiso', 'Dirección'],
      [
        [1, 'Calle Exacta 1'],
        [2, 'Solo calle 5'],
        [3, 'Nada 9'],
      ],
    );
    const id = await uploadAndAnalyze(
      layer.id,
      'g.csv',
      buf,
      analyzeInput({ 'N° Permiso': 'n_permiso', Dirección: 'direccion' }),
    );
    expect((await getStatus(db, id)).pendingGeocode).toBe(3);

    for (const rowNumber of [2, 3, 4]) await runGeocodeExternal(db, id, rowNumber, { geocoder });
    expect(calls).toHaveLength(3);
    const rows = (await listRows(db, id, { page: 1, pageSize: 10 })).data;
    expect(rows[0]!.parsed).toMatchObject({
      lat: -33.565,
      lon: -70.67,
      coordsSource: 'geocoded',
      geocode: { provider: 'nominatim', confidence: 'exact' },
    });
    expect(rows[0]!.status).toBe('valid');
    expect(rows[1]!.parsed?.lat).toBeNull();
    expect(rows[1]!.parsed?.suggestedLocation).toMatchObject({ lat: -33.566 });
    expect(rows[1]!.messages.map((m) => m.code)).toEqual(['location_approx']);
    expect(rows[2]!.messages.map((m) => m.code)).toEqual(['location_missing']);
    expect((await getStatus(db, id)).pendingGeocode).toBe(0);

    // aceptar todas las ubicaciones aproximadas en bloque
    const res = await bulkRows(db, editor, id, {
      filter: { code: 'location_approx' },
      action: 'accept_suggestion',
    });
    expect(res.updated).toBe(1);
    const [accepted] = (await listRows(db, id, { page: 2, pageSize: 1 })).data;
    expect(accepted!.parsed).toMatchObject({
      lat: -33.566,
      coordsSource: 'geocoded',
      suggestedLocation: null,
    });
    expect(accepted!.status).toBe('valid');

    // la caché evita volver a llamar al proveedor
    await geocoder.geocodeExternal('Calle Exacta 1');
    expect(calls).toHaveLength(3);
  });
});

describe('Borradores: hoja, descartar, permisos y limpieza', () => {
  it('cambiar de hoja vuelve a leer y detectar encabezados; descartar borra filas y archivo', async () => {
    const layer = await createLayer({ hasRole: true, fields: baseFields() });
    const buf = await xlsxBuffer(['Rol', 'N° Permiso'], [[roleOf(1), 1]], { titleRows: 2 });
    const source = await uploadImport(db, editor, layer.id, fakeFile('x.xlsx', buf));
    expect(source.headerRow).toBe(3);
    const other = await patchImportSource(db, editor, source.importId, { sheetName: 'Resumen' });
    expect(other.sheetName).toBe('Resumen');
    expect(other.headers).toEqual(['Total', '1']);
    await expect(patchImportSource(db, editor, source.importId, { sheetName: 'Nada' })).rejects.toThrow(
      /no existe/,
    );

    const [imp] = await db.select().from(imports).where(eq(imports.id, source.importId));
    expect(await storage.exists(imp!.fileKey!)).toBe(true);
    await expect(discardImport(db, { ...editor, userId: 'otro' }, source.importId)).rejects.toThrow(
      ForbiddenError,
    );
    await discardImport(db, admin, source.importId);
    const after = await getStatus(db, source.importId);
    expect(after.status).toBe('DISCARDED');
    expect(await storage.exists(imp!.fileKey!)).toBe(false);
    await expect(startAnalyze(db, editor, source.importId, analyzeInput({ Rol: 'roleId' }))).rejects.toThrow(
      ConflictError,
    );
  });

  it('la limpieza diaria descarta los borradores vencidos y el historial los lista', async () => {
    const layer = await createLayer({ hasRole: true, fields: baseFields() });
    const source = await uploadImport(
      db,
      editor,
      layer.id,
      fakeFile('v.csv', csvBuffer(['Rol', 'N° Permiso'], [[roleOf(1), 1]])),
    );
    expect(await cleanupExpiredImports(db)).toBe(0);
    await db
      .update(imports)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(imports.id, source.importId));
    expect(await cleanupExpiredImports(db)).toBe(1);
    expect((await getStatus(db, source.importId)).status).toBe('DISCARDED');

    const list = await listImports(db, editor, { page: 1, pageSize: 10, layerId: layer.id });
    expect(list.total).toBe(1);
    expect(list.data[0]).toMatchObject({ id: source.importId, layerName: layer.name, status: 'DISCARDED' });
    expect(list.data[0]).not.toHaveProperty('fileKey');
  });

  it('rechaza archivos que no son csv/xlsx y encabezados inválidos sin dejar basura en storage', async () => {
    const layer = await createLayer({ hasRole: true, fields: baseFields() });
    await expect(uploadImport(db, editor, layer.id, fakeFile('a.pdf', Buffer.from('x')))).rejects.toThrow(
      /\.csv o \.xlsx/,
    );
    await expect(
      uploadImport(db, editor, layer.id, fakeFile('a.csv', Buffer.from('Rol;Rol\n1;2\n'))),
    ).rejects.toThrow(/Fila 1: Hay encabezados repetidos: "Rol"/);
    await expect(
      uploadImport(db, editor, layer.id, fakeFile('a.csv', Buffer.from('Rol;;Monto\n1;2;3\n'))),
    ).rejects.toThrow(/columna B no tiene nombre/);
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(imports);
    expect(Number(cnt!.n)).toBe(0);
  });
});
