import { count, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/db/client';
import { layers, records } from '@/db/schema';
import type { LayerField } from '@/shared/schemas/layers';
import { normalizeText } from '@/shared/text';
import type { SummaryItem } from '@/shared/types';
import { formatFieldValue } from '@/lib/format';
import { NotFoundError } from '../errors';

/** Columnas de `records` sin `geom` (EWKB que el cliente no necesita). */
const { geom: _geom, ...recordColumnsWithoutGeom } = getTableColumns(records);
export const recordColumns = recordColumnsWithoutGeom;

export type LayerRow = typeof layers.$inferSelect;
export type RecordRowNoGeom = Omit<typeof records.$inferSelect, 'geom'>;

export async function countRows(db: DbOrTx, table: PgTable, where?: SQL): Promise<number> {
  const rows = await db.select({ total: count() }).from(table).where(where);
  return Number(rows[0]?.total ?? 0);
}

export async function requireLayer(db: DbOrTx, layerId: number): Promise<LayerRow> {
  const [layer] = await db.select().from(layers).where(sql`${layers.id} = ${layerId}`).limit(1);
  if (!layer) throw new NotFoundError('La capa no existe o fue eliminada');
  return layer;
}

/** Resumen de un registro: los 3 primeros campos con valor (§7.4). */
export function buildSummary(fields: LayerField[], attributes: Record<string, unknown>, max = 3): SummaryItem[] {
  const out: SummaryItem[] = [];
  for (const f of fields) {
    const v = attributes[f.key];
    if (v === null || v === undefined || v === '') continue;
    out.push({ label: f.label, value: formatFieldValue(v, f.type) });
    if (out.length >= max) break;
  }
  return out;
}

/** Normalización para comparar identidades (§8.4): texto trim, espacios colapsados, minúsculas, sin acentos. */
export function normalizeIdentityValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return normalizeText(String(v));
}

/** Misma normalización en SQL (aproximada: acentos comunes del español). */
export function normalizeIdentitySql(expr: SQL): SQL {
  return sql`lower(trim(regexp_replace(translate(coalesce(${expr}, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\\s+', ' ', 'g')))`;
}

/** Escapa `%`, `_` y `\` para usar en ILIKE. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function attr(key: string): SQL {
  return sql`${records.attributes}->>${key}`;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
