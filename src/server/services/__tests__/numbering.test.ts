/**
 * Correlativos (§8.8 / §7.12): sin repetidos ni huecos bajo concurrencia, contador que nunca baja,
 * reinicio anual por secuencia, correcciones de admin. Contra BD real.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLogs } from '@/db/schema';
import { ConflictError, ForbiddenError, ValidationError } from '@/server/errors';
import * as numbering from '../numbering';
import * as recordsService from '../records';
import { admin, createLayer, db, editor, field, getRecordRow, insertRecord, setupDbSuite } from './helpers';

setupDbSuite();

const autoFields = (reset: 'never' | 'yearly' = 'never') => [
  field('n_permiso', 'N° Permiso', 'autonumber', { options: reset === 'yearly' ? { reset, yearFieldKey: 'anio' } : { reset } }),
  field('anio', 'Año', 'number'),
  field('obs', 'Observaciones'),
];

describe('assignNumber', () => {
  it('20 asignaciones simultáneas en la misma capa → 20 números consecutivos sin repetidos ni huecos', async () => {
    const layer = await createLayer({ fields: autoFields() });
    const ids: number[] = [];
    for (let i = 0; i < 20; i++) ids.push((await insertRecord({ layerId: layer.id })).id);

    const results = await Promise.all(ids.map((id) => numbering.assignNumber(db, editor, id)));
    const numbers = results.map((r) => r.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(numbers).size).toBe(20);
    expect(results.every((r) => r.fieldKey === 'n_permiso')).toBe(true);

    // lo guardado en la BD coincide y el contador quedó en 20
    const stored = (await Promise.all(ids.map((id) => getRecordRow(id)))).map((r) => r!.attributes.n_permiso as number).sort((a, b) => a - b);
    expect(stored).toEqual(numbers);
    const counters = await numbering.getCounters(db, layer.id);
    expect(counters).toEqual([{ fieldKey: 'n_permiso', period: '', lastValue: 20, next: 21 }]);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, 'ASSIGN_NUMBER'));
    expect(logs).toHaveLength(20);
  });

  it('con números históricos hasta N (importados), la primera asignación da N+1', async () => {
    const layer = await createLayer({ fields: autoFields() });
    await insertRecord({ layerId: layer.id, attributes: { n_permiso: 6123 } });
    await insertRecord({ layerId: layer.id, attributes: { n_permiso: 6000 } });
    const preview = await numbering.previewNextNumber(db, layer.id);
    expect(preview?.next).toBe(6124);
    const rec = await insertRecord({ layerId: layer.id });
    const r = await numbering.assignNumber(db, editor, rec.id);
    expect(r.number).toBe(6124);
    const row = await getRecordRow(rec.id);
    expect(row?.numberAssignedAt).toBeInstanceOf(Date);
  });

  it('marca number_assigned_at/by y asignar dos veces → Conflict', async () => {
    const layer = await createLayer({ fields: autoFields() });
    const rec = await insertRecord({ layerId: layer.id });
    await numbering.assignNumber(db, editor, rec.id);
    await expect(numbering.assignNumber(db, editor, rec.id)).rejects.toBeInstanceOf(ConflictError);
    // un número histórico también cuenta como "ya tiene número"
    const hist = await insertRecord({ layerId: layer.id, attributes: { n_permiso: 3 } });
    await expect(numbering.assignNumber(db, editor, hist.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('dos asignaciones simultáneas sobre el mismo registro → una da el número y la otra Conflict, sin huecos', async () => {
    const layer = await createLayer({ fields: autoFields() });
    for (let i = 1; i <= 10; i++) {
      const rec = await insertRecord({ layerId: layer.id });
      const outcomes = await Promise.allSettled([numbering.assignNumber(db, editor, rec.id), numbering.assignNumber(db, editor, rec.id)]);
      const numbers = outcomes.flatMap((o) => (o.status === 'fulfilled' ? [o.value.number] : []));
      const errors = outcomes.flatMap((o) => (o.status === 'rejected' ? [o.reason] : []));
      expect(numbers).toEqual([i]);
      expect(errors).toEqual([expect.any(ConflictError)]);
      expect((await getRecordRow(rec.id))?.attributes.n_permiso).toBe(i);
    }
    // el contador avanzó uno por registro y hay una sola asignación auditada por registro
    expect(await numbering.getCounters(db, layer.id)).toEqual([{ fieldKey: 'n_permiso', period: '', lastValue: 10, next: 11 }]);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, 'ASSIGN_NUMBER'));
    expect(logs).toHaveLength(10);
  });

  it('borrar el registro con el último número no lo reutiliza', async () => {
    const layer = await createLayer({ fields: autoFields() });
    const a = await insertRecord({ layerId: layer.id });
    const b = await insertRecord({ layerId: layer.id });
    await numbering.assignNumber(db, editor, a.id);
    const last = await numbering.assignNumber(db, editor, b.id);
    expect(last.number).toBe(2);
    await recordsService.deleteRecord(db, admin, b.id, 'Permiso anulado por error de ingreso');
    const c = await insertRecord({ layerId: layer.id });
    const next = await numbering.assignNumber(db, editor, c.id);
    expect(next.number).toBe(3);
  });

  it('un registro con correlativo de la plataforma solo lo borra un admin, con motivo', async () => {
    const layer = await createLayer({ fields: autoFields() });
    const a = await insertRecord({ layerId: layer.id });
    await numbering.assignNumber(db, editor, a.id);
    await expect(recordsService.deleteRecord(db, editor, a.id, 'motivo')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordsService.deleteRecord(db, admin, a.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(recordsService.deleteRecord(db, admin, a.id, 'Duplicado')).resolves.toBeUndefined();
  });

  it('reinicio anual: secuencia por año y escribe el año en yearFieldKey', async () => {
    const layer = await createLayer({ fields: autoFields('yearly') });
    const year = new Date().getFullYear();
    // histórico de otro año con número alto: no afecta la secuencia del año actual
    await insertRecord({ layerId: layer.id, attributes: { n_permiso: 500, anio: 2019 } });
    // histórico del año actual
    await insertRecord({ layerId: layer.id, attributes: { n_permiso: 7, anio: year } });

    const a = await insertRecord({ layerId: layer.id });
    const b = await insertRecord({ layerId: layer.id });
    const ra = await numbering.assignNumber(db, editor, a.id);
    const rb = await numbering.assignNumber(db, editor, b.id);
    expect([ra.number, rb.number]).toEqual([8, 9]);
    const row = await getRecordRow(a.id);
    expect(row?.attributes.anio).toBe(year);

    const counters = await numbering.getCounters(db, layer.id);
    expect(counters.find((c) => c.period === String(year))).toEqual({ fieldKey: 'n_permiso', period: String(year), lastValue: 9, next: 10 });
    expect(await numbering.previewNextNumber(db, layer.id, '2019')).toMatchObject({ period: '2019', next: 501 });
  });

  it('capa sin correlativo → error de validación; previewNextNumber devuelve null', async () => {
    const layer = await createLayer();
    const rec = await insertRecord({ layerId: layer.id });
    await expect(numbering.assignNumber(db, editor, rec.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await numbering.previewNextNumber(db, layer.id)).toBeNull();
    expect(await numbering.getCounters(db, layer.id)).toEqual([]);
  });
});

describe('correcciones de admin (§7.12)', () => {
  it('setNumber con un número que ya tiene otro registro → Conflict', async () => {
    const layer = await createLayer({ fields: autoFields() });
    const a = await insertRecord({ layerId: layer.id });
    const b = await insertRecord({ layerId: layer.id });
    await numbering.assignNumber(db, editor, a.id); // 1
    await expect(numbering.setNumber(db, admin, b.id, 1, 'Corrección')).rejects.toBeInstanceOf(ConflictError);
    // un valor de texto en otro registro no rompe la comparación numérica
    await insertRecord({ layerId: layer.id, attributes: { n_permiso: 'sin número' } });
    await expect(numbering.setNumber(db, admin, b.id, 2, 'Corrección')).resolves.toEqual({ number: 2 });
  });

  it('setNumber por encima del contador lo sube; quitar el número no lo baja', async () => {
    const layer = await createLayer({ fields: autoFields() });
    const a = await insertRecord({ layerId: layer.id });
    await numbering.setNumber(db, admin, a.id, 100, 'Número entregado fuera de la plataforma');
    expect((await getRecordRow(a.id))?.numberAssignedAt).toBeInstanceOf(Date);
    expect(await numbering.previewNextNumber(db, layer.id)).toMatchObject({ lastValue: 100, next: 101 });

    await numbering.setNumber(db, admin, a.id, null, 'Anulado');
    const row = await getRecordRow(a.id);
    expect(row?.attributes.n_permiso).toBeNull();
    expect(row?.numberAssignedAt).toBeNull();
    expect(await numbering.previewNextNumber(db, layer.id)).toMatchObject({ lastValue: 100, next: 101 });

    const b = await insertRecord({ layerId: layer.id });
    expect((await numbering.assignNumber(db, editor, b.id)).number).toBe(101);
  });

  it('setNextNumber valida contra el máximo existente y contra el contador', async () => {
    const layer = await createLayer({ fields: autoFields() });
    await insertRecord({ layerId: layer.id, attributes: { n_permiso: 50 } });
    const a = await insertRecord({ layerId: layer.id });
    await numbering.assignNumber(db, editor, a.id); // 51, contador = 51

    await expect(numbering.setNextNumber(db, admin, layer.id, '', 51, 'x')).rejects.toBeInstanceOf(ValidationError); // <= max
    await expect(numbering.setNextNumber(db, admin, layer.id, '', 10, 'x')).rejects.toBeInstanceOf(ValidationError);
    await expect(numbering.setNextNumber(db, admin, layer.id, '', 60, 'Se entregaron números en Excel')).resolves.toEqual({ next: 60 });

    const b = await insertRecord({ layerId: layer.id });
    expect((await numbering.assignNumber(db, editor, b.id)).number).toBe(60);
    // el contador nunca baja: no se puede volver a 55
    await expect(numbering.setNextNumber(db, admin, layer.id, '', 55, 'x')).rejects.toBeInstanceOf(ValidationError);
  });
});
