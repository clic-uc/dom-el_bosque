import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { layerCounters, records } from '@/db/schema';
import { autonumberOptionsSchema, type LayerField } from '@/shared/schemas/layers';
import type { LayerCounter } from '@/shared/types';
import type { Actor } from '../auth/session';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireLayer, type LayerRow } from './_shared';
import * as audit from './audit';

/**
 * Correlativos (§8.8): un campo `autonumber` por capa, asignación explícita, sin repetidos ni huecos,
 * contador que nunca baja. Próximo = max(lastValue, máximo existente en la capa para el período) + 1.
 */

export function getAutonumberField(layer: Pick<LayerRow, 'fields'>): (LayerField & { reset: 'never' | 'yearly'; yearFieldKey?: string }) | null {
  const f = layer.fields.find((x) => x.type === 'autonumber');
  if (!f) return null;
  const opts = autonumberOptionsSchema.parse(f.options);
  return { ...f, reset: opts.reset, yearFieldKey: opts.yearFieldKey };
}

function currentPeriod(field: { reset: 'never' | 'yearly' }, date = new Date()): string {
  return field.reset === 'yearly' ? String(date.getFullYear()) : '';
}

async function maxExisting(tx: DbOrTx, layerId: number, field: { key: string; reset: 'never' | 'yearly'; yearFieldKey?: string }, period: string): Promise<number> {
  const periodCond =
    field.reset === 'yearly' && field.yearFieldKey
      ? sql` AND (${records.attributes}->>${field.yearFieldKey}) = ${period}`
      : sql``;
  const rows = await tx.execute<{ m: number | null }>(sql`
    SELECT max((attributes->>${field.key})::bigint) AS m
    FROM records
    WHERE layer_id = ${layerId}
      AND jsonb_typeof(attributes->${field.key}) = 'number'
      ${periodCond}
  `);
  return Number(rows[0]?.m ?? 0);
}

/** Bloquea (o crea) la fila del contador. Debe llamarse dentro de una transacción. */
async function lockCounter(tx: DbOrTx, layerId: number, fieldKey: string, period: string) {
  await tx
    .insert(layerCounters)
    .values({ layerId, fieldKey, period, lastValue: 0 })
    .onConflictDoNothing();
  const rows = await tx.execute<{ last_value: number }>(sql`
    SELECT last_value FROM layer_counters
    WHERE layer_id = ${layerId} AND field_key = ${fieldKey} AND period = ${period}
    FOR UPDATE
  `);
  return Number(rows[0]?.last_value ?? 0);
}

export async function previewNextNumber(db: DbOrTx, layerId: number, period?: string): Promise<LayerCounter | null> {
  const layer = await requireLayer(db, layerId);
  const field = getAutonumberField(layer);
  if (!field) return null;
  const p = period ?? currentPeriod(field);
  const [counter] = await db
    .select()
    .from(layerCounters)
    .where(and(eq(layerCounters.layerId, layerId), eq(layerCounters.fieldKey, field.key), eq(layerCounters.period, p)))
    .limit(1);
  const last = Number(counter?.lastValue ?? 0);
  const max = await maxExisting(db, layerId, field, p);
  return { fieldKey: field.key, period: p, lastValue: last, next: Math.max(last, max) + 1 };
}

export async function assignNumber(db: DbOrTx, actor: Actor, recordId: number): Promise<{ number: number; fieldKey: string }> {
  return db.transaction(async (tx) => {
    const [rec] = await tx.select().from(records).where(eq(records.id, recordId)).limit(1);
    if (!rec) throw new NotFoundError('El registro no existe o fue eliminado');
    const layer = await requireLayer(tx, rec.layerId);
    const field = getAutonumberField(layer);
    if (!field) throw new ValidationError('Esta capa no tiene un campo correlativo');

    const existing = rec.attributes[field.key];
    if (existing !== null && existing !== undefined && existing !== '') {
      throw new ConflictError(`Este registro ya tiene el ${field.label} ${String(existing)}`);
    }

    const period = currentPeriod(field);
    const last = await lockCounter(tx, rec.layerId, field.key, period);
    const max = await maxExisting(tx, rec.layerId, field, period);
    const next = Math.max(last, max) + 1;

    const newAttrs: Record<string, unknown> = { ...rec.attributes, [field.key]: next };
    if (field.reset === 'yearly' && field.yearFieldKey) newAttrs[field.yearFieldKey] = Number(period);

    await tx
      .update(records)
      .set({ attributes: newAttrs, numberAssignedAt: new Date(), numberAssignedBy: actor.userId, updatedBy: actor.userId })
      .where(eq(records.id, recordId));
    await tx
      .update(layerCounters)
      .set({ lastValue: next })
      .where(and(eq(layerCounters.layerId, rec.layerId), eq(layerCounters.fieldKey, field.key), eq(layerCounters.period, period)));
    await audit.log(tx, {
      actor,
      action: 'ASSIGN_NUMBER',
      entityType: 'RECORD',
      entityId: recordId,
      layerId: rec.layerId,
      metadata: { fieldKey: field.key, label: field.label, number: next, period },
    });
    return { number: next, fieldKey: field.key };
  });
}

/** Corrección excepcional (solo admin, §7.12). Quitar un número no libera el contador. */
export async function setNumber(
  db: DbOrTx,
  actor: Actor,
  recordId: number,
  value: number | null,
  reason: string,
): Promise<{ number: number | null }> {
  return db.transaction(async (tx) => {
    const [rec] = await tx.select().from(records).where(eq(records.id, recordId)).limit(1);
    if (!rec) throw new NotFoundError('El registro no existe o fue eliminado');
    const layer = await requireLayer(tx, rec.layerId);
    const field = getAutonumberField(layer);
    if (!field) throw new ValidationError('Esta capa no tiene un campo correlativo');

    const period =
      field.reset === 'yearly' && field.yearFieldKey ? String(rec.attributes[field.yearFieldKey] ?? currentPeriod(field)) : '';
    const last = await lockCounter(tx, rec.layerId, field.key, period);

    if (value !== null) {
      const periodCond =
        field.reset === 'yearly' && field.yearFieldKey
          ? sql` AND (attributes->>${field.yearFieldKey}) = ${period}`
          : sql``;
      const clash = await tx.execute<{ id: number }>(sql`
        SELECT id FROM records
        WHERE layer_id = ${rec.layerId} AND id <> ${recordId} AND (attributes->>${field.key})::bigint = ${value}
        ${periodCond}
        LIMIT 1
      `);
      if (clash.length) {
        throw new ConflictError(`El ${field.label} ${value} ya lo tiene otro registro de esta capa`, {
          existingRecordId: clash[0]!.id,
        });
      }
    }

    const before = rec.attributes[field.key] ?? null;
    const newAttrs: Record<string, unknown> = { ...rec.attributes, [field.key]: value };
    await tx
      .update(records)
      .set({
        attributes: newAttrs,
        numberAssignedAt: value === null ? null : (rec.numberAssignedAt ?? new Date()),
        numberAssignedBy: value === null ? null : (rec.numberAssignedBy ?? actor.userId),
        updatedBy: actor.userId,
      })
      .where(eq(records.id, recordId));
    if (value !== null && value > last) {
      await tx
        .update(layerCounters)
        .set({ lastValue: value })
        .where(and(eq(layerCounters.layerId, rec.layerId), eq(layerCounters.fieldKey, field.key), eq(layerCounters.period, period)));
    }
    await audit.log(tx, {
      actor,
      action: 'UPDATE',
      entityType: 'RECORD',
      entityId: recordId,
      layerId: rec.layerId,
      metadata: { correction: 'number', fieldKey: field.key, before, after: value, reason },
    });
    return { number: value };
  });
}

export async function getCounters(db: DbOrTx, layerId: number): Promise<LayerCounter[]> {
  const layer = await requireLayer(db, layerId);
  const field = getAutonumberField(layer);
  if (!field) return [];
  const rows = await db
    .select()
    .from(layerCounters)
    .where(and(eq(layerCounters.layerId, layerId), eq(layerCounters.fieldKey, field.key)));
  const periods = new Set(rows.map((r) => r.period));
  periods.add(currentPeriod(field));
  const out: LayerCounter[] = [];
  for (const p of [...periods].sort()) {
    const last = Number(rows.find((r) => r.period === p)?.lastValue ?? 0);
    const max = await maxExisting(db, layerId, field, p);
    out.push({ fieldKey: field.key, period: p, lastValue: last, next: Math.max(last, max) + 1 });
  }
  return out;
}

/** Ajusta el próximo número (solo admin). Debe ser mayor que el máximo existente en el período. */
export async function setNextNumber(db: DbOrTx, actor: Actor, layerId: number, period: string, next: number, reason: string): Promise<{ next: number }> {
  return db.transaction(async (tx) => {
    const layer = await requireLayer(tx, layerId);
    const field = getAutonumberField(layer);
    if (!field) throw new ValidationError('Esta capa no tiene un campo correlativo');
    const p = field.reset === 'yearly' ? period || currentPeriod(field) : '';
    const last = await lockCounter(tx, layerId, field.key, p);
    const max = await maxExisting(tx, layerId, field, p);
    if (next <= max) throw new ValidationError(`El próximo número debe ser mayor que ${max} (el mayor que ya existe en la capa)`);
    if (next - 1 < last) throw new ValidationError(`El contador no puede bajar: ya se entregó el número ${last}`);
    await tx
      .update(layerCounters)
      .set({ lastValue: next - 1 })
      .where(and(eq(layerCounters.layerId, layerId), eq(layerCounters.fieldKey, field.key), eq(layerCounters.period, p)));
    await audit.log(tx, {
      actor,
      action: 'UPDATE',
      entityType: 'LAYER',
      entityId: layerId,
      layerId,
      metadata: { counter: field.key, period: p, before: last + 1, after: next, reason },
    });
    return { next };
  });
}
