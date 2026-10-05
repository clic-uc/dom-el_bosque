import { and, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { records } from '@/db/schema';
import type { DuplicateConflictDetails, DuplicatesPreview } from '@/shared/types';
import { formatFieldValue } from '@/lib/format';
import { ConflictError } from '../errors';
import { attr, normalizeIdentitySql, normalizeIdentityValue, type LayerRow } from './_shared';

/**
 * Identidad de un registro dentro de su capa (§8.4):
 *   capa con rol: rol + valores de uniqueKeys; capa sin rol: valores de uniqueKeys.
 */

export type Identity = {
  /** clave canónica para comparar ('rol|v1|v2' normalizado) */
  key: string;
  /** partes legibles para mensajes */
  parts: Record<string, string>;
  complete: boolean;
};

type LayerIdentityConfig = Pick<LayerRow, 'hasRole' | 'uniqueKeys' | 'fields'>;

/** ¿La capa detecta duplicados? (sin campos únicos no hay identidad) */
export function layerDetectsDuplicates(layer: LayerIdentityConfig): boolean {
  return layer.uniqueKeys.length > 0;
}

export function buildIdentity(
  layer: LayerIdentityConfig,
  roleId: string | null,
  attributes: Record<string, unknown>,
  uniqueKeysOverride?: string[],
): Identity | null {
  const uniqueKeys = uniqueKeysOverride ?? layer.uniqueKeys;
  if (uniqueKeys.length === 0) return null;

  const keyParts: string[] = [];
  const parts: Record<string, string> = {};
  let complete = true;

  if (layer.hasRole) {
    if (!roleId) complete = false;
    keyParts.push(roleId ?? '');
    parts['Rol SII'] = roleId ?? '';
  }
  for (const k of uniqueKeys) {
    const raw = attributes[k];
    const norm = normalizeIdentityValue(raw);
    if (norm === '') complete = false;
    keyParts.push(norm);
    const field = layer.fields.find((f) => f.key === k);
    parts[field?.label ?? k] = raw === null || raw === undefined ? '' : formatFieldValue(raw, field?.type ?? 'string');
  }

  return { key: keyParts.join('\u0001'), parts, complete };
}

/** "rol 00050-00001 y N° Permiso 123" para mensajes de conflicto. */
export function describeIdentity(identity: Identity): string {
  const entries = Object.entries(identity.parts).map(([label, value]) =>
    label === 'Rol SII' ? `rol ${value || 'sin rol'}` : `${label} ${value || '(vacío)'}`,
  );
  if (entries.length <= 1) return entries[0] ?? '';
  return `${entries.slice(0, -1).join(', ')} y ${entries[entries.length - 1]}`;
}

/** Busca registros existentes con la misma identidad (consulta puntual para crear/editar). */
export async function findDuplicateIds(
  db: DbOrTx,
  layer: LayerRow,
  identity: Identity,
  excludeRecordId?: number,
  roleId?: string | null,
  attributes?: Record<string, unknown>,
): Promise<number[]> {
  if (!identity.complete) return [];
  const conds: SQL[] = [eq(records.layerId, layer.id)];
  if (layer.hasRole) conds.push(eq(records.roleId, roleId ?? ''));
  for (const k of layer.uniqueKeys) {
    const norm = normalizeIdentityValue(attributes?.[k]);
    conds.push(sql`${normalizeIdentitySql(attr(k))} = ${norm}`);
  }
  if (excludeRecordId) conds.push(ne(records.id, excludeRecordId));

  const rows = await db
    .select({ id: records.id, roleId: records.roleId, attributes: records.attributes })
    .from(records)
    .where(and(...conds))
    .limit(50);

  // verificación final con la normalización completa de JS
  return rows
    .filter((r) => buildIdentity(layer, r.roleId, r.attributes)?.key === identity.key)
    .map((r) => r.id);
}

/** Lanza `Conflict` con detalles para el botón "Abrir registro existente" (§8.4). */
export async function assertNoDuplicate(
  db: DbOrTx,
  layer: LayerRow,
  roleId: string | null,
  attributes: Record<string, unknown>,
  excludeRecordId?: number,
): Promise<void> {
  const identity = buildIdentity(layer, roleId, attributes);
  if (!identity || !identity.complete) return;
  const ids = await findDuplicateIds(db, layer, identity, excludeRecordId, roleId, attributes);
  if (ids.length > 0) {
    const details: DuplicateConflictDetails = { kind: 'duplicate', existingRecordId: ids[0]!, identity: identity.parts };
    throw new ConflictError(`Ya existe un registro con ${describeIdentity(identity)} en esta capa`, details);
  }
}

/** Índice en memoria de identidades existentes de una capa (para analizar importaciones de 40k filas). */
export async function loadIdentityIndex(
  db: DbOrTx,
  layer: LayerRow,
): Promise<Map<string, number[]>> {
  const index = new Map<string, number[]>();
  if (!layerDetectsDuplicates(layer)) return index;
  const rows = await db
    .select({ id: records.id, roleId: records.roleId, attributes: records.attributes })
    .from(records)
    .where(eq(records.layerId, layer.id));
  for (const r of rows) {
    const idn = buildIdentity(layer, r.roleId, r.attributes);
    if (!idn || !idn.complete) continue;
    const list = index.get(idn.key);
    if (list) list.push(r.id);
    else index.set(idn.key, [r.id]);
  }
  return index;
}

/** Cuántos grupos de registros existentes quedarían repetidos con estos campos únicos (§7.1). */
export async function previewDuplicates(db: DbOrTx, layer: LayerRow, uniqueKeys: string[]): Promise<DuplicatesPreview> {
  if (uniqueKeys.length === 0) return { groups: 0, records: 0, sample: [] };
  const rows = await db
    .select({ id: records.id, roleId: records.roleId, attributes: records.attributes })
    .from(records)
    .where(eq(records.layerId, layer.id));

  const groups = new Map<string, { parts: Record<string, string>; ids: number[] }>();
  for (const r of rows) {
    const idn = buildIdentity(layer, r.roleId, r.attributes, uniqueKeys);
    if (!idn || !idn.complete) continue;
    const g = groups.get(idn.key);
    if (g) g.ids.push(r.id);
    else groups.set(idn.key, { parts: idn.parts, ids: [r.id] });
  }
  const dup = [...groups.values()].filter((g) => g.ids.length > 1);
  return {
    groups: dup.length,
    records: dup.reduce((acc, g) => acc + g.ids.length, 0),
    sample: dup.slice(0, 10).map((g) => ({ key: g.parts, recordIds: g.ids })),
  };
}

