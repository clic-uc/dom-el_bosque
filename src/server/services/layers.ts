import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { layers, records } from '@/db/schema';
import type { FieldType } from '@/shared/constants';
import {
  autonumberOptionsSchema,
  type CreateLayerData,
  type LayerField,
  type UpdateLayerData,
} from '@/shared/schemas/layers';
import { slugify, toFieldKey, uniqueSuffix } from '@/shared/text';
import type { DuplicatesPreview, TypeConversionPreview } from '@/shared/types';
import type { Actor } from '../auth/session';
import { NotFoundError, ValidationError } from '../errors';
import { castValue, previewTypeConversion } from '../parsing/values';
import { requireLayer, type LayerRow } from './_shared';
import * as attachmentsService from './attachments';
import * as audit from './audit';
import { previewDuplicates as previewDuplicatesImpl } from './duplicates';
import { assertCanDropNumbers, numberedRefs, plural, type NumberedRecordRef } from './numbered';
import { getAutonumberField } from './numbering';

export type LayerWithCountRow = LayerRow & { recordCount: number; numberedRecordCount: number };

export async function listLayers(db: DbOrTx): Promise<LayerWithCountRow[]> {
  const rows = await db
    .select({
      layer: layers,
      // Identificadores explícitos: en un select sin joins Drizzle quita el prefijo de tabla y `"id"` se resolvería a records.id.
      recordCount: sql<number>`(SELECT count(*)::int FROM records r WHERE r.layer_id = layers.id)`,
      numberedRecordCount: sql<number>`(SELECT count(*)::int FROM records r WHERE r.layer_id = layers.id AND r.number_assigned_at IS NOT NULL)`,
    })
    .from(layers)
    .orderBy(asc(layers.department), asc(layers.sortOrder), asc(layers.name));
  return rows.map((r) => ({
    ...r.layer,
    recordCount: Number(r.recordCount),
    numberedRecordCount: Number(r.numberedRecordCount),
  }));
}

export async function getLayer(db: DbOrTx, id: number): Promise<LayerWithCountRow> {
  const layer = await requireLayer(db, id);
  const [{ n, numbered } = { n: 0, numbered: 0 }] = await db
    .select({
      n: sql<number>`count(*)::int`,
      numbered: sql<number>`(count(*) FILTER (WHERE ${records.numberAssignedAt} IS NOT NULL))::int`,
    })
    .from(records)
    .where(eq(records.layerId, id));
  return { ...layer, recordCount: Number(n), numberedRecordCount: Number(numbered) };
}

/** Asigna `key` a los campos nuevos (sin key o con key vacía) a partir del label (§5.2). */
export function assignFieldKeys(fields: (Partial<LayerField> & { label: string })[], existingKeys: string[] = []): LayerField[] {
  const taken = [...existingKeys];
  return fields.map((f) => {
    let key = f.key && f.key.trim() !== '' ? f.key : '';
    if (!key) {
      key = uniqueSuffix(toFieldKey(f.label), taken);
    }
    taken.push(key);
    return {
      key,
      label: f.label,
      type: f.type ?? 'string',
      required: f.required ?? false,
      options: f.options ?? {},
    };
  });
}

async function uniqueSlug(db: DbOrTx, name: string, excludeId?: number): Promise<string> {
  const base = slugify(name);
  const rows = await db.select({ slug: layers.slug, id: layers.id }).from(layers);
  const taken = rows.filter((r) => r.id !== excludeId).map((r) => r.slug);
  return uniqueSuffix(base, taken, '-');
}

export async function createLayer(db: DbOrTx, actor: Actor, input: CreateLayerData): Promise<LayerRow> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, input.name);
    const [maxSort] = await tx.select({ m: sql<number>`coalesce(max(${layers.sortOrder}), -1)::int` }).from(layers);
    const [row] = await tx
      .insert(layers)
      .values({
        slug,
        name: input.name,
        department: input.department,
        hasRole: input.hasRole,
        fields: input.fields,
        uniqueKeys: input.uniqueKeys,
        addressFieldKey: input.addressFieldKey ?? null,
        heatmapFieldKey: input.heatmapFieldKey ?? null,
        icon: input.icon,
        iconColor: input.iconColor,
        sortOrder: input.sortOrder ?? Number(maxSort?.m ?? -1) + 1,
      })
      .returning();
    await audit.log(tx, {
      actor,
      action: 'CREATE',
      entityType: 'LAYER',
      entityId: row!.id,
      layerId: row!.id,
      metadata: { name: row!.name, department: row!.department, fields: row!.fields.length },
    });
    return row!;
  });
}

export type FieldsMigrationReport = {
  removed: { key: string; label: string; affectedRecords: number }[];
  renamed: { from: string; to: string; affectedRecords: number }[];
  converted: { key: string; toType: FieldType; converted: number; keptAsText: number }[];
};

/**
 * Cambios en `fields` (§7.2): eliminados → quitar clave del JSONB; renombrados → mover clave;
 * cambio de tipo → convertir los convertibles (los demás quedan como texto).
 */
async function migrateFieldChanges(
  tx: DbOrTx,
  layerId: number,
  before: LayerField[],
  after: LayerField[],
  renames: { from: string; to: string }[],
  convertTypes: string[],
): Promise<FieldsMigrationReport> {
  const report: FieldsMigrationReport = { removed: [], renamed: [], converted: [] };
  const renameMap = new Map(renames.map((r) => [r.from, r.to]));
  const afterKeys = new Set(after.map((f) => f.key));

  // renombres primero
  for (const { from, to } of renames) {
    if (!afterKeys.has(to)) throw new ValidationError(`El campo renombrado "${to}" no está en la lista de campos`);
    const res = await tx.execute<{ id: number }>(sql`
      UPDATE records SET attributes = (attributes - ${from}::text) || jsonb_build_object(${to}::text, attributes->${from}::text), updated_at = now()
      WHERE layer_id = ${layerId} AND attributes ? ${from}::text
      RETURNING id
    `);
    report.renamed.push({ from, to, affectedRecords: res.length });
  }

  // eliminados (los que no están en after ni fueron renombrados)
  for (const f of before) {
    if (afterKeys.has(f.key) || renameMap.has(f.key)) continue;
    const res = await tx.execute<{ id: number }>(sql`
      UPDATE records SET attributes = attributes - ${f.key}::text, updated_at = now()
      WHERE layer_id = ${layerId} AND attributes ? ${f.key}::text
      RETURNING id
    `);
    report.removed.push({ key: f.key, label: f.label, affectedRecords: res.length });
  }

  // cambios de tipo
  for (const bf of before) {
    const newKey = renameMap.get(bf.key) ?? bf.key;
    const af = after.find((f) => f.key === newKey);
    if (!af || af.type === bf.type) continue;
    if (!convertTypes.includes(newKey) && !convertTypes.includes(bf.key)) {
      throw new ValidationError(
        `El campo "${af.label}" cambia de tipo. Revisa la vista previa de conversión y confirma el cambio.`,
      );
    }
    const rows = await tx
      .select({ id: records.id, value: sql<unknown>`${records.attributes}->${newKey}` })
      .from(records)
      .where(sql`${records.layerId} = ${layerId} AND ${records.attributes} ? ${newKey}`);
    let converted = 0;
    let keptAsText = 0;
    const failures: unknown[] = [];
    for (const r of rows) {
      if (r.value === null || r.value === undefined || r.value === '') continue;
      const cast = castValue(r.value, af.type);
      if (cast.ok) {
        if (JSON.stringify(cast.value) !== JSON.stringify(r.value)) {
          await tx.execute(sql`
            UPDATE records SET attributes = attributes || jsonb_build_object(${newKey}::text, ${JSON.stringify(cast.value)}::jsonb)
            WHERE id = ${r.id}
          `);
        }
        converted++;
      } else {
        if (af.type === 'autonumber') failures.push(r.value);
        else {
          await tx.execute(sql`
            UPDATE records SET attributes = attributes || jsonb_build_object(${newKey}::text, ${JSON.stringify(String(r.value))}::jsonb)
            WHERE id = ${r.id}
          `);
        }
        keptAsText++;
      }
    }
    if (af.type === 'autonumber' && failures.length > 0) {
      throw new ValidationError(
        `Para convertir "${af.label}" en correlativo, todos los valores existentes deben ser números enteros. Hay ${failures.length} que no lo son (por ejemplo: ${failures.slice(0, 3).map(String).join(', ')}).`,
        { samples: failures.slice(0, 10) },
      );
    }
    report.converted.push({ key: newKey, toType: af.type, converted, keptAsText });
  }

  return report;
}

/** Vista previa de conversión de tipo para la UI (§7.2). */
export async function previewFieldTypeChange(
  db: DbOrTx,
  layerId: number,
  key: string,
  toType: FieldType,
): Promise<TypeConversionPreview> {
  const layer = await requireLayer(db, layerId);
  const field = layer.fields.find((f) => f.key === key);
  if (!field) throw new NotFoundError('El campo no existe en esta capa');
  const rows = await db
    .select({ value: sql<unknown>`${records.attributes}->${key}` })
    .from(records)
    .where(sql`${records.layerId} = ${layerId} AND ${records.attributes} ? ${key}`);
  const p = previewTypeConversion(
    rows.map((r) => r.value),
    toType,
  );
  return { key, label: field.label, fromType: field.type, toType, ...p };
}

/**
 * El cambio de campos hace perder los números del correlativo (§8.8): elimina el campo, lo deja con otro tipo
 * o, en el correlativo anual, elimina el campo de año. Un renombre mueve los valores y no cuenta.
 */
function dropsAutonumber(before: LayerRow, afterFields: LayerField[], renameMap: Map<string, string>): boolean {
  const auto = getAutonumberField(before);
  if (!auto) return false;
  const after = afterFields.find((f) => f.key === (renameMap.get(auto.key) ?? auto.key));
  if (!after || after.type !== 'autonumber') return true;
  if (auto.reset === 'yearly' && auto.yearFieldKey) {
    const yearKey = renameMap.get(auto.yearFieldKey) ?? auto.yearFieldKey;
    if (!afterFields.some((f) => f.key === yearKey)) return true;
  }
  return false;
}

export async function updateLayer(db: DbOrTx, actor: Actor, id: number, patch: UpdateLayerData): Promise<LayerRow> {
  return db.transaction(async (tx) => {
    const before = await requireLayer(tx, id);
    const set: Partial<typeof layers.$inferInsert> = {};

    if (patch.name !== undefined && patch.name !== before.name) {
      set.name = patch.name;
      set.slug = await uniqueSlug(tx, patch.name, id);
    }
    if (patch.department !== undefined) set.department = patch.department;
    if (patch.hasRole !== undefined) set.hasRole = patch.hasRole;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.iconColor !== undefined) set.iconColor = patch.iconColor;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;

    let migration: FieldsMigrationReport | null = null;
    let numberedRecords: NumberedRecordRef[] = [];
    const afterFields = patch.fields ?? before.fields;
    const renameMap = new Map(patch.renames.map((r) => [r.from, r.to]));
    if (patch.fields !== undefined) {
      // validar correlativo anual: el campo de año debe existir
      const auto = afterFields.find((f) => f.type === 'autonumber');
      if (auto) {
        const opts = autonumberOptionsSchema.parse(auto.options);
        if (opts.reset === 'yearly' && !afterFields.some((f) => f.key === opts.yearFieldKey)) {
          throw new ValidationError('El correlativo anual necesita un campo de año válido');
        }
      }
      if (dropsAutonumber(before, afterFields, renameMap)) {
        // Con lock: un número asignado mientras tanto no escapa a la cuenta.
        const numbered = await tx
          .select({ id: records.id, attributes: records.attributes })
          .from(records)
          .where(and(eq(records.layerId, id), isNotNull(records.numberAssignedAt)))
          .orderBy(asc(records.id))
          .for('update');
        assertCanDropNumbers(actor, numbered.length, patch.reason, {
          forbidden: `${plural(numbered.length, 'registro tiene', 'registros tienen')} un número asignado por la plataforma. Solo un administrador puede quitar o cambiar el campo correlativo.`,
          reasonRequired: `Quitar o cambiar el campo correlativo borra el número de ${plural(numbered.length, 'registro', 'registros')}. Indica el motivo.`,
        });
        numberedRecords = numberedRefs(before, numbered);
      }
      migration = await migrateFieldChanges(tx, id, before.fields, afterFields, patch.renames, patch.convertTypes);
      set.fields = afterFields;
    }

    const keys = new Set(afterFields.map((f) => f.key));
    const remap = (k: string | null | undefined): string | null => {
      if (!k) return null;
      const nk = renameMap.get(k) ?? k;
      return keys.has(nk) ? nk : null;
    };

    // uniqueKeys / addressFieldKey / heatmapFieldKey: usar lo enviado o remapear lo existente (§7.2)
    const uniqueKeys = (patch.uniqueKeys ?? before.uniqueKeys).map((k) => remap(k)).filter((k): k is string => !!k);
    set.uniqueKeys = [...new Set(uniqueKeys)];

    const addressKey = patch.addressFieldKey !== undefined ? patch.addressFieldKey : before.addressFieldKey;
    const addressField = afterFields.find((f) => f.key === remap(addressKey));
    set.addressFieldKey = addressField && addressField.type === 'string' ? addressField.key : null;

    const heatKey = patch.heatmapFieldKey !== undefined ? patch.heatmapFieldKey : before.heatmapFieldKey;
    const heatField = afterFields.find((f) => f.key === remap(heatKey));
    set.heatmapFieldKey = heatField && heatField.type === 'number' ? heatField.key : null;

    const [after] = await tx.update(layers).set(set).where(eq(layers.id, id)).returning();
    const { before: b, after: a } = audit.diff(
      { name: before.name, department: before.department, hasRole: before.hasRole, fields: before.fields, uniqueKeys: before.uniqueKeys, addressFieldKey: before.addressFieldKey, heatmapFieldKey: before.heatmapFieldKey, icon: before.icon, iconColor: before.iconColor },
      { name: after!.name, department: after!.department, hasRole: after!.hasRole, fields: after!.fields, uniqueKeys: after!.uniqueKeys, addressFieldKey: after!.addressFieldKey, heatmapFieldKey: after!.heatmapFieldKey, icon: after!.icon, iconColor: after!.iconColor },
    );
    await audit.log(tx, {
      actor,
      action: 'UPDATE',
      entityType: 'LAYER',
      entityId: id,
      layerId: id,
      metadata: {
        before: b,
        after: a,
        ...(migration ? { migration } : {}),
        ...(numberedRecords.length ? { reason: patch.reason, numberedRecords } : {}),
      },
    });
    return after!;
  });
}

export async function deleteLayer(db: DbOrTx, actor: Actor, id: number, reason?: string): Promise<void> {
  const storageKeys = await db.transaction(async (tx) => {
    const layer = await requireLayer(tx, id);
    const recs = await tx
      .select({ id: records.id, numberAssignedAt: records.numberAssignedAt, attributes: records.attributes })
      .from(records)
      .where(eq(records.layerId, id))
      .orderBy(asc(records.id))
      .for('update');
    const numbered = recs.filter((r) => r.numberAssignedAt);
    assertCanDropNumbers(actor, numbered.length, reason, {
      forbidden: `Esta capa tiene ${plural(numbered.length, 'registro', 'registros')} con número asignado por la plataforma. Solo un administrador puede eliminarla.`,
      reasonRequired: `Esta capa tiene ${plural(numbered.length, 'registro', 'registros')} con número asignado por la plataforma. Indica el motivo para eliminarla.`,
    });
    const keys = await attachmentsService.deleteForEntity(
      tx,
      'record',
      recs.map((r) => String(r.id)),
    );
    await tx.delete(layers).where(eq(layers.id, id)); // cascade borra registros, contadores e importaciones
    await audit.log(tx, {
      actor,
      action: 'DELETE',
      entityType: 'LAYER',
      entityId: id,
      layerId: id,
      metadata: {
        name: layer.name,
        slug: layer.slug,
        deletedRecords: recs.length,
        fields: layer.fields,
        ...(numbered.length ? { reason, numberedRecords: numberedRefs(layer, numbered) } : {}),
      },
    });
    return keys;
  });
  await attachmentsService.purgeStorageKeys(storageKeys);
}

export async function previewDuplicates(db: DbOrTx, layerId: number, uniqueKeys: string[]): Promise<DuplicatesPreview> {
  const layer = await requireLayer(db, layerId);
  const unknown = uniqueKeys.filter((k) => !layer.fields.some((f) => f.key === k));
  if (unknown.length) throw new ValidationError(`Campos desconocidos: ${unknown.join(', ')}`);
  return previewDuplicatesImpl(db, layer, uniqueKeys);
}

