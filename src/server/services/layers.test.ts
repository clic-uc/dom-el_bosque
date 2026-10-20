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
import { createLayerSchema, type CreateLayerInput, type LayerField } from '@/shared/schemas/layers';
import { raceWithOpenTransaction } from './__tests__/helpers';
import * as svc from './layers';

const actor: Actor = { userId: 't', email: 't@t', name: 'T', role: 'admin', rawRole: 'admin', mustChangePassword: false };
const editorActor: Actor = { ...actor, userId: 'e', role: 'editor', rawRole: 'editor' };

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

async function insertRecord(
  layerId: number,
  attributes: Record<string, unknown>,
  roleId: string | null = null,
  numberAssignedAt: Date | null = null,
) {
  const [row] = await db.insert(records).values({ layerId, roleId, attributes, numberAssignedAt }).returning();
  return row!;
}

/** Capa con correlativo `n_permiso` y un registro con número asignado por la plataforma. */
async function makeNumberedLayer() {
  const layer = await makeLayer({
    fields: svc.assignFieldKeys([
      { label: 'N° Permiso', type: 'autonumber' },
      { label: 'Dirección' },
      { label: 'Año', type: 'number' },
    ]),
  });
  const numbered = await insertRecord(layer.id, { n_permiso: 7, direccion: 'Calle 1' }, null, new Date());
  await insertRecord(layer.id, { direccion: 'Calle 2' });
  return { layer, numbered };
}

const withoutField = (layer: { fields: LayerField[] }, key: string) => layer.fields.filter((f) => f.key !== key);

async function attrsOf(layerId: number) {
  const rows = await db
    .select({ id: records.id, attributes: records.attributes })
    .from(records)
    .where(eq(records.layerId, layerId))
    .orderBy(records.id);
  return rows.map((r) => r.attributes);
}

// Las suites de servicios comparten la BD de prueba: un advisory lock las serializa aunque vitest las ejecute en paralelo.
let lock: Awaited<ReturnType<typeof sqlClient.reserve>> | undefined;
beforeAll(async () => {
  lock = await sqlClient.reserve();
  await lock`SELECT pg_advisory_lock(730001)`;
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE records, layers, layer_counters, audit_logs, roles RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  if (lock) {
    await lock`SELECT pg_advisory_unlock(730001)`;
    lock.release();
  }
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

describe('updateLayer: correlativo con números asignados (§8.8)', () => {
  it('un editor no puede eliminar el campo correlativo ni cambiarle el tipo', async () => {
    const { layer, numbered } = await makeNumberedLayer();

    await expect(
      svc.updateLayer(db, editorActor, layer.id, {
        fields: withoutField(layer, 'n_permiso'),
        renames: [],
        convertTypes: [],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const asText = layer.fields.map((f) => (f.key === 'n_permiso' ? { ...f, type: 'string' as const } : f));
    await expect(
      svc.updateLayer(db, editorActor, layer.id, { fields: asText, renames: [], convertTypes: ['n_permiso'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [row] = await db.select().from(records).where(eq(records.id, numbered.id));
    expect(row!.attributes.n_permiso).toBe(7);
  });

  it('en un correlativo anual, un editor no puede eliminar el campo de año', async () => {
    const layer = await makeLayer({
      fields: [
        { key: 'n_permiso', label: 'N° Permiso', type: 'autonumber', required: false, options: { reset: 'yearly', yearFieldKey: 'anio' } },
        { key: 'anio', label: 'Año', type: 'number', required: false, options: {} },
      ],
    });
    await insertRecord(layer.id, { n_permiso: 3, anio: 2026 }, null, new Date());
    // Para eliminar el año, el correlativo tiene que pasar a no reiniciarse: igual se pierde el año de cada número.
    const fields = [{ ...layer.fields[0]!, options: { reset: 'never' } }];
    await expect(
      svc.updateLayer(db, editorActor, layer.id, { fields, renames: [], convertTypes: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('un administrador sin motivo recibe reasonRequired; con motivo, los números quedan en el registro de auditoría', async () => {
    const { layer, numbered } = await makeNumberedLayer();
    const patch = { fields: withoutField(layer, 'n_permiso'), renames: [], convertTypes: [] };

    await expect(svc.updateLayer(db, actor, layer.id, patch)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reasonRequired: true, count: 1 },
    });

    await svc.updateLayer(db, actor, layer.id, { ...patch, reason: 'Se cambia la numeración' });
    const [row] = await db.select().from(records).where(eq(records.id, numbered.id));
    expect(row!.attributes).not.toHaveProperty('n_permiso');
    expect(row!.numberAssignedAt).not.toBeNull();
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'UPDATE'));
    expect(log!.metadata).toMatchObject({
      reason: 'Se cambia la numeración',
      numberedRecords: [{ id: numbered.id, number: 7 }],
    });
  });

  it('renombrar la clave del correlativo no pide motivo, y sin registros numerados un editor lo elimina', async () => {
    const { layer, numbered } = await makeNumberedLayer();
    const fields = layer.fields.map((f) => (f.key === 'n_permiso' ? { ...f, key: 'permiso' } : f));
    await svc.updateLayer(db, editorActor, layer.id, {
      fields,
      renames: [{ from: 'n_permiso', to: 'permiso' }],
      convertTypes: [],
    });
    const [row] = await db.select().from(records).where(eq(records.id, numbered.id));
    expect(row!.attributes.permiso).toBe(7);

    const plain = await makeLayer({
      name: 'Sin números',
      fields: svc.assignFieldKeys([{ label: 'N° Permiso', type: 'autonumber' }, { label: 'Dirección' }]),
    });
    await insertRecord(plain.id, { direccion: 'Calle 3' });
    const after = await svc.updateLayer(db, editorActor, plain.id, {
      fields: withoutField(plain, 'n_permiso'),
      renames: [],
      convertTypes: [],
    });
    expect(fieldsOf(after)).toEqual(['direccion']);
  });

  it('un número que se está asignando mientras se quita el correlativo entra en la cuenta y no se borra', async () => {
    const layer = await makeLayer({
      fields: svc.assignFieldKeys([{ label: 'N° Permiso', type: 'autonumber' }, { label: 'Dirección' }]),
    });
    const rec = await insertRecord(layer.id, { direccion: 'Calle 1' });

    // Otra transacción le asigna número y aún no confirma: el editor tiene que esperarla y ver ese número.
    const { waited, result } = await raceWithOpenTransaction(
      (conn) =>
        conn`UPDATE records SET attributes = attributes || '{"n_permiso": 1}'::jsonb, number_assigned_at = now() WHERE id = ${rec.id}`,
      () =>
        svc.updateLayer(db, editorActor, layer.id, {
          fields: withoutField(layer, 'n_permiso'),
          renames: [],
          convertTypes: [],
        }),
    );
    expect(waited).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', details: { count: 1 } } });
    const [row] = await db.select().from(records).where(eq(records.id, rec.id));
    expect(row!.attributes.n_permiso).toBe(1);
    expect(fieldsOf((await db.select().from(layers).where(eq(layers.id, layer.id)))[0]!)).toContain('n_permiso');
  });

  it('listLayers y getLayer cuentan los registros numerados', async () => {
    const { layer } = await makeNumberedLayer();
    expect((await svc.listLayers(db))[0]).toMatchObject({ recordCount: 2, numberedRecordCount: 1 });
    expect(await svc.getLayer(db, layer.id)).toMatchObject({ recordCount: 2, numberedRecordCount: 1 });
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

  it('con registros numerados: un editor no puede; un admin necesita motivo y los números quedan auditados', async () => {
    const { layer, numbered } = await makeNumberedLayer();

    await expect(svc.deleteLayer(db, editorActor, layer.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.deleteLayer(db, actor, layer.id)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reasonRequired: true, count: 1 },
    });
    expect(await db.select().from(records)).toHaveLength(2);

    await svc.deleteLayer(db, actor, layer.id, 'Capa duplicada');
    expect(await db.select().from(layers)).toHaveLength(0);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'DELETE'));
    expect(log!.metadata).toMatchObject({
      reason: 'Capa duplicada',
      deletedRecords: 2,
      numberedRecords: [{ id: numbered.id, number: 7 }],
    });
  });
});
