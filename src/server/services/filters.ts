import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { records } from '@/db/schema';
import type { FilterOptions } from '@/shared/types';
import { requireLayer } from './_shared';

/**
 * Valores distintos por campo (§7.5): ≤100 valores → lista ordenada (incluye '' como "(Vacío)"); si no, 'text'.
 * Caché en memoria 60 s por capa, invalidada al escribir.
 */
const cache = new Map<number, { at: number; value: FilterOptions }>();
const TTL_MS = 60_000;

export function invalidateFilterOptions(layerId?: number): void {
  if (layerId === undefined) cache.clear();
  else cache.delete(layerId);
}

export async function getFilterOptions(db: DbOrTx, layerId: number): Promise<FilterOptions> {
  const hit = cache.get(layerId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const layer = await requireLayer(db, layerId);
  const out: FilterOptions = {};
  for (const f of layer.fields) {
    const rows = await db
      .selectDistinct({ v: sql<string | null>`${records.attributes}->>${f.key}` })
      .from(records)
      .where(eq(records.layerId, layerId))
      .limit(101);
    if (rows.length > 100) {
      out[f.key] = 'text';
      continue;
    }
    const values = rows.map((r) => r.v ?? '');
    const unique = [...new Set(values)];
    unique.sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.localeCompare(b, 'es-CL', { sensitivity: 'base', numeric: true });
    });
    out[f.key] = unique;
  }
  cache.set(layerId, { at: Date.now(), value: out });
  return out;
}
