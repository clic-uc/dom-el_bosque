import { and, asc, eq, gt } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { records } from '@/db/schema';
import { coordsSourceLabels } from '@/shared/constants';
import { formatFieldValue } from '@/lib/format';
import { neutralizeFormula } from '../csv';
import { requireLayer } from './_shared';

/**
 * Exportación CSV en stream (§7.6): BOM UTF-8, columnas id, roleId (si hasRole), lat, lon,
 * origen_coordenadas, campos por label, comments. Todos los registros (con y sin coordenadas).
 */

function csvCell(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return '';
  const s = neutralizeFormula(String(value));
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportCsv(
  db: DbOrTx,
  layerId: number,
  opts: { delimiter: ',' | ';' },
): Promise<{ stream: ReadableStream<Uint8Array>; fileName: string }> {
  const layer = await requireLayer(db, layerId);
  const d = opts.delimiter;
  const encoder = new TextEncoder();
  const header = [
    'id',
    ...(layer.hasRole ? ['roleId'] : []),
    'lat',
    'lon',
    'origen_coordenadas',
    ...layer.fields.map((f) => f.label),
    'comments',
  ];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `export-${layer.slug}-${stamp}.csv`;

  const BATCH = 2000;
  // Paginación por cursor (`id > lastId`): cada `pull` entrega un lote y el consumidor marca el ritmo.
  let lastId = 0;
  let done = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('﻿' + header.map((h) => csvCell(h, d)).join(d) + '\r\n'));
    },
    async pull(controller) {
      if (done) {
        controller.close();
        return;
      }
      try {
        const page = await db
          .select({
            id: records.id,
            roleId: records.roleId,
            lat: records.lat,
            lon: records.lon,
            coordsSource: records.coordsSource,
            attributes: records.attributes,
            comments: records.comments,
          })
          .from(records)
          .where(and(eq(records.layerId, layerId), gt(records.id, lastId)))
          .orderBy(asc(records.id))
          .limit(BATCH);
        if (page.length === 0) {
          done = true;
          controller.close();
          return;
        }
        const chunk = page
          .map((r) => {
            lastId = r.id;
            const cells = [
              r.id,
              ...(layer.hasRole ? [r.roleId ?? ''] : []),
              r.lat ?? '',
              r.lon ?? '',
              r.coordsSource ? coordsSourceLabels[r.coordsSource] : '',
              ...layer.fields.map((f) => formatFieldValue(r.attributes[f.key], f.type)),
              r.comments ?? '',
            ];
            return cells.map((c) => csvCell(c, d)).join(d);
          })
          .join('\r\n');
        controller.enqueue(encoder.encode(chunk + '\r\n'));
        if (page.length < BATCH) {
          done = true;
          controller.close();
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return { stream, fileName };
}
