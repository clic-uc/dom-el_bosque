/**
 * Tests de `layers.service` contra una BD real (PostGIS). Requiere DATABASE_URL apuntando a una base
 * de prueba ya migrada, p. ej. postgres://postgres:password@localhost:5432/sigdom_test_a
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sqlClient } from '@/db/client';
import { auditLogs, layers, records, roles } from '@/db/schema';
import type { Actor } from '@/server/auth/session';
import { ValidationError } from '@/server/errors';
import { createLayerSchema, type CreateLayerInput } from '@/shared/schemas/layers';
import * as svc from './layers';

const actor: Actor = { userId: 't', email: 't@t', name: 'T', role: 'admin', rawRole: 'admin', mustChangePassword: false };

function fieldsOf(layer: { fields: { key: string }[] }) {
  return layer.fields.map((f) => f.key);
}

async function makeLayer(overrides: Partial<CreateLayerInput> = {}) {
  const input = createLayerSchema.parse({
    name: 'Obras Menores',
    department: 'edificacion',
    hasRole: true,
    fields: svc.assignFieldKeys([
      { label: 'N° Permiso' },
      { label: 'Dirección' },
      { label: 'Superficie', type: 'number' },
    ]),
    ...overrides,
  });
  return svc.createLayer(db, actor, input);
}

async function insertRecord(layerId: number, attributes: Record<string, unknown>, roleId: string | null = null) {
  const [row] = await db.insert(records).values({ layerId, roleId, attributes }).returning();
  return row!;
}

async function attrsOf(layerId: number) {
  const rows = await db
    .select({ id: records.id, attributes: records.attributes })
    .from(records)
    .where(eq(records.layerId, layerId))
    .orderBy(records.id);
  return rows.map((r) => r.attributes);
}

// Las suites de servicios comparten la BD de prueba: un advisory lock las serializa aunque vitest las ejecute en paralelo.
let lock: Awaited<ReturnType<typeof sqlClient.reserve>>;
beforeAll(async () => {
  lock = await sqlClient.reserve();
  await lock`SELECT pg_advisory_lock(730001)`;
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE records, layers, layer_counters, audit_logs, roles RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await lock`SELECT pg_advisory_unlock(730001)`;
  lock.release();
  await sqlClient.end({ timeout: 5 });
});

describe('assignFieldKeys (§5.2)', () => {
  it('genera la key en snake_case desde el label y evita choques con sufijos', () => {
    const fields = svc.assignFieldKeys([{ label: 'N° Permiso' }, { label: 'N° Permiso' }, { label: 'Año' }, { label: '2024' }]);
    expect(fields.map((f) => f.key)).toEqual(['n_permiso', 'n_permiso_2', 'ano', 'c_2024']);
    expect(fields[0]).toMatchObject({ type: 'string', required: false, options: {} });
  });

  it('respeta las keys existentes y no las repite', () => {
    const fields = svc.assignFieldKeys([{ key: 'dir', label: 'Dirección' }, { label: 'Dir' }], ['otro']);
    expect(fields.map((f) => f.key)).toEqual(['dir', 'dir_2']);
  });
});

describe('createLayer', () => {
  it('genera un slug único con sufijo -2, -3 y audita', async () => {
    const a = await makeLayer();
    const b = await makeLayer();
    const c = await makeLayer();
    expect(a.slug).toBe('obras-menores');
    expect(b.slug).toBe('obras-menores-2');
    expect(c.slug).toBe('obras-menores-3');
    expect(fieldsOf(a)).toEqual(['n_permiso', 'direccion', 'superficie']);
    expect(a.sortOrder).toBe(0);
    expect(c.sortOrder).toBe(2);
    const logs = await db.select().from(auditLogs);
    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({ action: 'CREATE', entityType: 'LAYER', entityId: String(a.id), userId: 't' });
  });

  it('listLayers incluye recordCount y getLayer devuelve la capa con su conteo', async () => {
    const a = await makeLayer();
    await insertRecord(a.id, { n_permiso: '1' });
    await insertRecord(a.id, { n_permiso: '2' });
    const list = await svc.listLayers(db);
    expect(list).toHaveLength(1);
    expect(list[0]!.recordCount).toBe(2);
    const one = await svc.getLayer(db, a.id);
    expect(one.recordCount).toBe(2);
    await expect(svc.getLayer(db, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('updateLayer: migración de campos (§7.2)', () => {
  it('renombrar la key mueve el valor en el JSONB de los registros', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: '123', direccion: 'Calle 1' });
    await insertRecord(layer.id, { direccion: 'Calle 2' });

    const fields = layer.fields.map((f) =>
      f.key === 'n_permiso' ? { ...f, key: 'numero_permiso', label: 'Número Permiso' } : f,
    );
    const after = await svc.updateLayer(db, actor, layer.id, {
      fields,
      renames: [{ from: 'n_permiso', to: 'numero_permiso' }],
      convertTypes: [],
    });
    expect(fieldsOf(after)).toEqual(['numero_permiso', 'direccion', 'superficie']);
    const attrs = await attrsOf(layer.id);
    expect(attrs[0]).toEqual({ numero_permiso: '123', direccion: 'Calle 1' });
    expect(attrs[1]).toEqual({ direccion: 'Calle 2' });
  });

  it('eliminar un campo borra la clave de todos los registros', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: '1', direccion: 'A', superficie: 10 });
    await insertRecord(layer.id, { n_permiso: '2', superficie: 20 });

    const after = await svc.updateLayer(db, actor, layer.id, {
      fields: layer.fields.filter((f) => f.key !== 'direccion'),
      renames: [],
      convertTypes: [],
    });
    expect(fieldsOf(after)).toEqual(['n_permiso', 'superficie']);
    const attrs = await attrsOf(layer.id);
    expect(attrs).toEqual([
      { n_permiso: '1', superficie: 10 },
      { n_permiso: '2', superficie: 20 },
    ]);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'UPDATE'));
    expect(log!.metadata).toMatchObject({ migration: { removed: [{ key: 'direccion', affectedRecords: 1 }] } });
  });

  it('cambiar el tipo a número convierte los convertibles y deja como texto los demás', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: '1.234,5' });
    await insertRecord(layer.id, { n_permiso: '77' });
    await insertRecord(layer.id, { n_permiso: 'S/N' });
    await insertRecord(layer.id, { direccion: 'sin número' });

    const preview = await svc.previewFieldTypeChange(db, layer.id, 'n_permiso', 'number');
    expect(preview).toMatchObject({
      key: 'n_permiso',
      fromType: 'string',
      toType: 'number',
      convertible: 2,
      notConvertible: 1,
      samples: ['S/N'],
    });

    const fields = layer.fields.map((f) => (f.key === 'n_permiso' ? { ...f, type: 'number' as const } : f));
    // sin confirmación → error de validación
    await expect(
      svc.updateLayer(db, actor, layer.id, { fields, renames: [], convertTypes: [] }),
    ).rejects.toBeInstanceOf(ValidationError);

    await svc.updateLayer(db, actor, layer.id, { fields, renames: [], convertTypes: ['n_permiso'] });
    const attrs = await attrsOf(layer.id);
    expect(attrs[0]).toEqual({ n_permiso: 1234.5 });
    expect(attrs[1]).toEqual({ n_permiso: 77 });
    expect(attrs[2]).toEqual({ n_permiso: 'S/N' });
    expect(attrs[3]).toEqual({ direccion: 'sin número' });
  });

  it('pasar a correlativo falla si hay valores que no son enteros', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: '100' });
    await insertRecord(layer.id, { n_permiso: '100-A' });
    const fields = layer.fields.map((f) => (f.key === 'n_permiso' ? { ...f, type: 'autonumber' as const } : f));
    const err = await svc
      .updateLayer(db, actor, layer.id, { fields, renames: [], convertTypes: ['n_permiso'] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain('100-A');
    // la transacción se revirtió: nada cambió
    const fresh = await svc.getLayer(db, layer.id);
    expect(fresh.fields.find((f) => f.key === 'n_permiso')!.type).toBe('string');
    expect(await attrsOf(layer.id)).toEqual([{ n_permiso: '100' }, { n_permiso: '100-A' }]);
  });

  it('pasar a correlativo convierte los enteros a número cuando todos son válidos', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: '6.123' });
    await insertRecord(layer.id, { n_permiso: 45 });
    const fields = layer.fields.map((f) => (f.key === 'n_permiso' ? { ...f, type: 'autonumber' as const } : f));
    await svc.updateLayer(db, actor, layer.id, { fields, renames: [], convertTypes: ['n_permiso'] });
    expect(await attrsOf(layer.id)).toEqual([{ n_permiso: 6123 }, { n_permiso: 45 }]);
  });

  it('remapea uniqueKeys/addressFieldKey/heatmapFieldKey al renombrar y los quita al eliminar o cambiar de tipo', async () => {
    const layer = await makeLayer({
      uniqueKeys: ['n_permiso'],
      addressFieldKey: 'direccion',
      heatmapFieldKey: 'superficie',
    });
    expect(layer).toMatchObject({ uniqueKeys: ['n_permiso'], addressFieldKey: 'direccion', heatmapFieldKey: 'superficie' });

    // renombrar n_permiso y direccion
    const renamed = await svc.updateLayer(db, actor, layer.id, {
      fields: layer.fields.map((f) =>
        f.key === 'n_permiso' ? { ...f, key: 'permiso' } : f.key === 'direccion' ? { ...f, key: 'dir' } : f,
      ),
      renames: [
        { from: 'n_permiso', to: 'permiso' },
        { from: 'direccion', to: 'dir' },
      ],
      convertTypes: [],
    });
    expect(renamed).toMatchObject({ uniqueKeys: ['permiso'], addressFieldKey: 'dir', heatmapFieldKey: 'superficie' });

    // eliminar permiso y dir; superficie pasa a texto → heatmap se quita
    const removed = await svc.updateLayer(db, actor, layer.id, {
      fields: renamed.fields.filter((f) => f.key === 'superficie').map((f) => ({ ...f, type: 'string' as const })),
      renames: [],
      convertTypes: ['superficie'],
    });
    expect(removed).toMatchObject({ uniqueKeys: [], addressFieldKey: null, heatmapFieldKey: null });
  });

  it('cambia nombre (regenera slug), departamento, hasRole, ícono y color', async () => {
    const layer = await makeLayer();
    await makeLayer({ name: 'Recepción Final' });
    const after = await svc.updateLayer(db, actor, layer.id, {
      name: 'Recepción Final',
      department: 'vivienda',
      hasRole: false,
      icon: 'house',
      iconColor: '#10b981',
      renames: [],
      convertTypes: [],
    });
    expect(after).toMatchObject({
      name: 'Recepción Final',
      slug: 'recepcion-final-2',
      department: 'vivienda',
      hasRole: false,
      icon: 'house',
      iconColor: '#10b981',
    });
  });

  it('un correlativo anual exige un campo de año existente', async () => {
    const layer = await makeLayer();
    const fields = [
      ...layer.fields,
      {
        key: 'resolucion',
        label: 'Resolución',
        type: 'autonumber' as const,
        required: false,
        options: { reset: 'yearly', yearFieldKey: 'anio' },
      },
    ];
    await expect(
      svc.updateLayer(db, actor, layer.id, { fields, renames: [], convertTypes: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('previewDuplicates (§8.4)', () => {
  it('cuenta grupos de registros con la misma identidad (rol + campos únicos, normalizados)', async () => {
    const layer = await makeLayer();
    await db.insert(roles).values([{ id: '00050-00001' }, { id: '00050-00002' }]);
    await insertRecord(layer.id, { n_permiso: '123', direccion: 'Calle A' }, '00050-00001');
    await insertRecord(layer.id, { n_permiso: ' 123 ', direccion: 'Calle B' }, '00050-00001'); // mismo rol, mismo número → duplicado
    await insertRecord(layer.id, { n_permiso: '123' }, '00050-00002'); // otro rol → no
    await insertRecord(layer.id, { n_permiso: '124' }, '00050-00001'); // mismo rol, otro número → no
    await insertRecord(layer.id, { direccion: 'Calle A' }, '00050-00001'); // sin campo único → no se compara
    await insertRecord(layer.id, { direccion: 'calle a' }, '00050-00001');

    const byNumber = await svc.previewDuplicates(db, layer.id, ['n_permiso']);
    expect(byNumber).toMatchObject({ groups: 1, records: 2 });
    expect(byNumber.sample[0]!.key).toEqual({ 'Rol SII': '00050-00001', 'N° Permiso': '123' });
    expect(byNumber.sample[0]!.recordIds).toHaveLength(2);

    const byAddress = await svc.previewDuplicates(db, layer.id, ['direccion']);
    expect(byAddress).toMatchObject({ groups: 1, records: 3 }); // 'Calle A' (x2) y 'calle a' del mismo rol

    const both = await svc.previewDuplicates(db, layer.id, ['n_permiso', 'direccion']);
    expect(both).toMatchObject({ groups: 0, records: 0 });

    expect(await svc.previewDuplicates(db, layer.id, [])).toEqual({ groups: 0, records: 0, sample: [] });
    await expect(svc.previewDuplicates(db, layer.id, ['no_existe'])).rejects.toBeInstanceOf(ValidationError);
  });

  it('en una capa sin rol la identidad son solo los campos únicos', async () => {
    const layer = await makeLayer({ hasRole: false, fields: svc.assignFieldKeys([{ label: 'Rut' }]) });
    await insertRecord(layer.id, { rut: '12.345.678-9' });
    await insertRecord(layer.id, { rut: '12.345.678-9' });
    await insertRecord(layer.id, { rut: '1-9' });
    const p = await svc.previewDuplicates(db, layer.id, ['rut']);
    expect(p).toMatchObject({ groups: 1, records: 2 });
    expect(p.sample[0]!.key).toEqual({ Rut: '12.345.678-9' });
  });
});

describe('deleteLayer', () => {
  it('borra la capa y sus registros, y audita', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: '1' });
    await insertRecord(layer.id, { n_permiso: '2' });
    await svc.deleteLayer(db, actor, layer.id);
    expect(await db.select().from(layers)).toHaveLength(0);
    expect(await db.select().from(records)).toHaveLength(0);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'DELETE'));
    expect(log!.metadata).toMatchObject({ name: 'Obras Menores', deletedRecords: 2 });
    await expect(svc.deleteLayer(db, actor, layer.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
