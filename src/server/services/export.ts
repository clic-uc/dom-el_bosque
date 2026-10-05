import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { records } from '@/db/schema';
import { coordsSourceLabels } from '@/shared/constants';
import { formatFieldValue } from '@/lib/format';
import { requireLayer } from './_shared';

/**
 * Exportación CSV en stream (§7.6): BOM UTF-8, columnas id, roleId (si hasRole), lat, lon,
 * origen_coordenadas, campos por label, comments. Todos los registros (con y sin coordenadas).
 */

function csvCell(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportCsv(
  db: Db,
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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('﻿' + header.map((h) => csvCell(h, d)).join(d) + '\r\n'));
    },
    async pull(controller) {
      // se consume completo en una pasada por lotes
      let lastId = 0;
      try {
        for (;;) {
          const rows = await db
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
            .where(eq(records.layerId, layerId))
            .orderBy(asc(records.id))
            .limit(BATCH)
            .offset(0)
            .then((rs) => rs.filter((r) => r.id > lastId));
          const page = rows.length ? rows : [];
          if (page.length === 0) break;
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
          if (page.length < BATCH) break;
        }
      } finally {
        controller.close();
      }
    },
  });

  return { stream, fileName };
}
