/**
 * Tests de `numbering.service` en lo que toca a los contadores de una capa (§7.12 / §8.8), contra BD real.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sqlClient } from '@/db/client';
import { auditLogs, layerCounters, records } from '@/db/schema';
import type { Actor } from '@/server/auth/session';
import { ValidationError } from '@/server/errors';
import { createLayerSchema, type LayerFieldInput } from '@/shared/schemas/layers';
import { raceWithOpenTransaction } from './__tests__/helpers';
import * as layersSvc from './layers';
import * as svc from './numbering';

const actor: Actor = { userId: 't', email: 't@t', name: 'T', role: 'admin', rawRole: 'admin', mustChangePassword: false };

async function makeLayer(opts: { reset?: 'never' | 'yearly'; withAutonumber?: boolean } = {}) {
  const { reset = 'never', withAutonumber = true } = opts;
  const fields: LayerFieldInput[] = [
    { key: 'direccion', label: 'Dirección', type: 'string' },
    { key: 'anio', label: 'Año', type: 'number' },
  ];
  if (withAutonumber) {
    fields.unshift({
      key: 'n_permiso',
      label: 'N° Permiso',
      type: 'autonumber',
      options: reset === 'yearly' ? { reset, yearFieldKey: 'anio' } : { reset },
    });
  }
  const input = createLayerSchema.parse({ name: 'Obras Nuevas', department: 'edificacion', hasRole: true, fields });
  return layersSvc.createLayer(db, actor, input);
}

async function insertRecord(layerId: number, attributes: Record<string, unknown>) {
  const [row] = await db.insert(records).values({ layerId, attributes }).returning();
  return row!;
}

// Las suites de servicios comparten la BD de prueba: un advisory lock las serializa aunque vitest las ejecute en paralelo.
let lock: Awaited<ReturnType<typeof sqlClient.reserve>> | undefined;
beforeAll(async () => {
  lock = await sqlClient.reserve();
  await lock`SELECT pg_advisory_lock(730001)`;
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE records, layers, layer_counters, audit_logs RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  if (lock) {
    await lock`SELECT pg_advisory_unlock(730001)`;
    lock.release();
  }
  await sqlClient.end({ timeout: 5 });
});

describe('getCounters / previewNextNumber', () => {
  it('sin correlativo devuelve vacío / null', async () => {
    const layer = await makeLayer({ withAutonumber: false });
    expect(await svc.getCounters(db, layer.id)).toEqual([]);
    expect(await svc.previewNextNumber(db, layer.id)).toBeNull();
  });

  it('el próximo número es el máximo existente en la capa + 1 (números históricos importados)', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: 6123 });
    await insertRecord(layer.id, { n_permiso: 10 });
    await insertRecord(layer.id, { n_permiso: '9999' }); // texto: no cuenta (decisión 2026-10-05)
    const counters = await svc.getCounters(db, layer.id);
    expect(counters).toEqual([{ fieldKey: 'n_permiso', period: '', lastValue: 0, next: 6124 }]);
    expect(await svc.previewNextNumber(db, layer.id)).toEqual(counters[0]);
  });

  it('con reinicio anual hay una secuencia por año', async () => {
    const layer = await makeLayer({ reset: 'yearly' });
    await insertRecord(layer.id, { n_permiso: 40, anio: 2019 });
    await insertRecord(layer.id, { n_permiso: 7, anio: 2020 });
    const thisYear = String(new Date().getFullYear());
    // getCounters lista los períodos con contador más el actual; los años históricos se consultan con previewNextNumber
    expect(await svc.getCounters(db, layer.id)).toEqual([{ fieldKey: 'n_permiso', period: thisYear, lastValue: 0, next: 1 }]);
    expect(await svc.previewNextNumber(db, layer.id, '2019')).toMatchObject({ period: '2019', next: 41 });
    expect(await svc.previewNextNumber(db, layer.id, '2020')).toMatchObject({ period: '2020', next: 8 });
    expect(await svc.previewNextNumber(db, layer.id)).toMatchObject({ period: thisYear, next: 1 });
  });
});

describe('setNextNumber (solo admin, §7.12)', () => {
  it('sube el contador, audita con motivo y el próximo número cambia', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: 100 });
    const res = await svc.setNextNumber(db, actor, layer.id, '', 500, 'Se entregaron números en Excel');
    expect(res).toEqual({ next: 500 });
    const [counter] = await db.select().from(layerCounters);
    expect(counter).toMatchObject({ layerId: layer.id, fieldKey: 'n_permiso', period: '', lastValue: 499 });
    expect(await svc.getCounters(db, layer.id)).toEqual([{ fieldKey: 'n_permiso', period: '', lastValue: 499, next: 500 }]);
    const [log] = await db.select().from(auditLogs).where(sql`${auditLogs.action} = 'UPDATE'`);
    expect(log!.metadata).toMatchObject({
      counter: 'n_permiso',
      before: 101,
      after: 500,
      reason: 'Se entregaron números en Excel',
    });
  });

  it('rechaza un número menor o igual al máximo existente y no deja bajar el contador', async () => {
    const layer = await makeLayer();
    await insertRecord(layer.id, { n_permiso: 100 });
    await expect(svc.setNextNumber(db, actor, layer.id, '', 100, 'motivo válido')).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.setNextNumber(db, actor, layer.id, '', 50, 'motivo válido')).rejects.toBeInstanceOf(ValidationError);
    await svc.setNextNumber(db, actor, layer.id, '', 300, 'motivo válido');
    await expect(svc.setNextNumber(db, actor, layer.id, '', 200, 'motivo válido')).rejects.toBeInstanceOf(ValidationError);
    expect(await svc.getCounters(db, layer.id)).toMatchObject([{ next: 300 }]);
  });

  it('falla si la capa no tiene correlativo', async () => {
    const layer = await makeLayer({ withAutonumber: false });
    await expect(svc.setNextNumber(db, actor, layer.id, '', 10, 'motivo válido')).rejects.toBeInstanceOf(ValidationError);
  });

  it('con reinicio anual ajusta solo el período indicado', async () => {
    const layer = await makeLayer({ reset: 'yearly' });
    await insertRecord(layer.id, { n_permiso: 40, anio: 2019 });
    await svc.setNextNumber(db, actor, layer.id, '2019', 60, 'Corrección histórica');
    const counters = await svc.getCounters(db, layer.id);
    expect(counters.find((c) => c.period === '2019')).toMatchObject({ lastValue: 59, next: 60 });
    expect(counters.find((c) => c.period === String(new Date().getFullYear()))).toMatchObject({ next: 1 });
  });

  it('el contador sobrevive a la eliminación del registro con el último número', async () => {
    const layer = await makeLayer();
    const rec = await insertRecord(layer.id, { n_permiso: 10 });
    await svc.setNextNumber(db, actor, layer.id, '', 11, 'alinear');
    await db.delete(records).where(sql`${records.id} = ${rec.id}`);
    expect(await svc.getCounters(db, layer.id)).toMatchObject([{ next: 11 }]);
  });
});

describe('assignNumber / setNumber con transacciones concurrentes', () => {
  it('assignNumber espera a quien está quitando el correlativo y no reescribe atributos viejos', async () => {
    const layer = await makeLayer();
    const rec = await insertRecord(layer.id, { direccion: 'Calle 1' });

    // Otra transacción quita el campo correlativo (registros y capa) y aún no confirma.
    const { waited, result } = await raceWithOpenTransaction(
      async (conn) => {
        await conn`UPDATE records SET attributes = attributes - 'n_permiso' WHERE layer_id = ${layer.id}`;
        await conn`UPDATE layers SET fields = (SELECT jsonb_agg(f) FROM jsonb_array_elements(fields) f WHERE f->>'type' <> 'autonumber') WHERE id = ${layer.id}`;
      },
      () => svc.assignNumber(db, actor, rec.id),
    );
    expect(waited).toBe(true);
    expect(result).toMatchObject({ ok: false, error: expect.any(ValidationError) });
    const [row] = await db.select().from(records).where(sql`${records.id} = ${rec.id}`);
    expect(row!.attributes).toEqual({ direccion: 'Calle 1' });
    expect(row!.numberAssignedAt).toBeNull();
  });

  it('setNumber espera a quien está editando el registro y conserva sus cambios', async () => {
    const layer = await makeLayer();
    const rec = await insertRecord(layer.id, { direccion: 'Calle 1' });

    const { waited, result } = await raceWithOpenTransaction(
      (conn) =>
        conn`UPDATE records SET attributes = attributes || '{"direccion": "Calle 2"}'::jsonb WHERE id = ${rec.id}`,
      () => svc.setNumber(db, actor, rec.id, 5, 'corrección'),
    );
    expect(waited).toBe(true);
    expect(result).toMatchObject({ ok: true, value: { number: 5 } });
    const [row] = await db.select().from(records).where(sql`${records.id} = ${rec.id}`);
    expect(row!.attributes).toEqual({ direccion: 'Calle 2', n_permiso: 5 });
  });
});
