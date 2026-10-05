import { and, asc, eq } from 'drizzle-orm';
import Papa from 'papaparse';
import type { DbOrTx } from '@/db/client';
import { importRows } from '@/db/schema';
import { isRawOverrideKey } from './analysis';
import { requireImport } from './service';

/**
 * `GET /api/imports/:id/errors`: CSV con los encabezados originales + columna `Error`, solo las filas con
 * estado `error` (las excluidas no van). Con BOM y `;` para que Excel lo abra bien (§7.6).
 */
export async function buildErrorsCsv(db: DbOrTx, id: string): Promise<{ csv: string; count: number; fileName: string }> {
  const imp = await requireImport(db, id);
  const rows = await db
    .select({ rowNumber: importRows.rowNumber, raw: importRows.raw, messages: importRows.messages })
    .from(importRows)
    .where(and(eq(importRows.importId, id), eq(importRows.status, 'error')))
    .orderBy(asc(importRows.rowNumber));

  const headers = rows.length
    ? Object.keys(rows[0]!.raw).filter((k) => !isRawOverrideKey(k))
    : Object.keys(imp.columnMapping);

  const data = rows.map((r) => [
    String(r.rowNumber),
    ...headers.map((h) => r.raw[h] ?? ''),
    r.messages
      .filter((m) => m.level === 'error')
      .map((m) => m.message)
      .join(' | '),
  ]);

  const csv = '﻿' + Papa.unparse({ fields: ['Fila', ...headers, 'Error'], data }, { delimiter: ';', newline: '\r\n' });
  const base = imp.fileName.replace(/\.[^.]+$/, '') || 'importacion';
  return { csv, count: rows.length, fileName: `${base}-errores.csv` };
}
