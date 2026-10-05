import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { importRows, imports } from '@/db/schema';
import type { ImportMessage, ParsedRow } from '@/shared/schemas/import-rows';
import { getGeocoder, type Geocoder } from '../geocoding';
import { logger } from '../logger';
import { requireLayer } from '../services/_shared';
import {
  LOCATION_MISSING_MESSAGE,
  applyLocation,
  locationApproxMessage,
  statusFromMessages,
} from './analysis';
import { decrementPendingGeocodeSql } from './analyze';

/**
 * Handler de `import.geocode-external` (§8.5 paso 5 / §8.7): una fila por tarea, concurrencia 1 en el worker.
 * Usa solo proveedores externos (con caché y 1 req/s), actualiza la fila y descuenta `progress.pendingGeocode`.
 */
export async function runGeocodeExternal(
  db: DbOrTx,
  importId: string,
  rowNumber: number,
  deps: { geocoder?: Geocoder } = {},
): Promise<void> {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  if (!imp || (imp.status !== 'REVIEW' && imp.status !== 'ANALYZING')) return;

  const [row] = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.importId, importId), eq(importRows.rowNumber, rowNumber)))
    .limit(1);

  try {
    if (row && row.parsed && row.messages.some((m) => m.code === 'location_pending')) {
      const layer = await requireLayer(db, imp.layerId);
      const addressValue = layer.addressFieldKey ? row.parsed.attributes[layer.addressFieldKey] : null;
      const address = typeof addressValue === 'string' ? addressValue.trim() : '';
      const geocoder = deps.geocoder ?? getGeocoder(db);
      const result = address ? await geocoder.geocodeExternal(address) : null;

      let parsed: ParsedRow = row.parsed;
      let messages: ImportMessage[] = row.messages.filter((m) => m.code !== 'location_pending');
      if (result && result.confidence === 'exact') {
        ({ parsed, messages } = applyLocation(parsed, messages, {
          lat: result.lat,
          lon: result.lon,
          geocode: { provider: result.provider, confidence: result.confidence, query: address },
        }));
      } else if (result) {
        parsed = {
          ...parsed,
          suggestedLocation: {
            lat: result.lat,
            lon: result.lon,
            geocode: { provider: result.provider, confidence: result.confidence, query: address },
          },
        };
        messages.push(locationApproxMessage(result));
      } else {
        messages.push(LOCATION_MISSING_MESSAGE);
      }

      const status =
        row.status === 'valid' || row.status === 'warning' ? statusFromMessages(messages, false) : row.status;
      await db
        .update(importRows)
        .set({ parsed, messages, status })
        .where(and(eq(importRows.importId, importId), eq(importRows.rowNumber, rowNumber)));
    }
  } catch (err) {
    logger.warn({ err, importId, rowNumber }, 'import.geocode-external: fila sin resolver');
  } finally {
    await db.update(imports).set({ progress: decrementPendingGeocodeSql }).where(eq(imports.id, importId));
  }
}
