import iconv from 'iconv-lite';
import Papa from 'papaparse';
import { importDelimiters } from '@/shared/schemas/imports';
import { ValidationError } from '../errors';
import { buildTable, detectHeaderRow, type ParsedTable } from './table';

/**
 * Lectura de CSV para la importación (§8.5 paso 2): UTF-8 o Windows-1252 (si aparece U+FFFD al decodificar),
 * sin BOM, PapaParse con delimitador autodetectado o fijo. Las filas vacías se saltan pero conservan la numeración.
 */

export function decodeCsvBuffer(buffer: Buffer): string {
  let text = buffer.toString('utf8');
  if (text.includes('�')) text = iconv.decode(buffer, 'win1252');
  return text.replace(/^﻿/, '');
}

const stringifyCell = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export type ParseCsvOptions = {
  delimiter?: string | null;
  /** Fila (1-based) con los encabezados. Si no se indica, se detecta automáticamente. */
  headerRow?: number | null;
};

/**
 * Elige el delimitador más consistente en las primeras 50 líneas con contenido. A diferencia de la detección de
 * PapaParse, tolera filas de título sin delimitador sobre los encabezados (frecuentes en planillas municipales).
 */
export function guessDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 50);
  let best: { delimiter: string; score: number } = { delimiter: ';', score: -1 };
  for (const d of importDelimiters) {
    const counts = lines.map((l) => l.replace(/"[^"]*"/g, '').split(d).length - 1).filter((c) => c > 0);
    if (counts.length === 0) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const score = Math.max(...freq.values());
    if (score > best.score) best = { delimiter: d, score };
  }
  return best.score > 0 ? best.delimiter : ';';
}

export function parseCsvRecords(text: string, delimiter?: string | null): { records: string[][]; delimiter: string } {
  const result = Papa.parse<string[]>(text, {
    header: false,
    delimiter: delimiter || guessDelimiter(text),
    // Sin `skipEmptyLines`: las saltamos nosotros para que el número de fila coincida con el de la planilla.
    skipEmptyLines: false,
  });
  const records = result.data;
  // PapaParse deja una última fila vacía si el archivo termina en salto de línea
  while (records.length && records[records.length - 1]!.every((c) => c.trim() === '')) records.pop();
  return { records, delimiter: result.meta.delimiter };
}

export function parseCsv(buffer: Buffer, opts: ParseCsvOptions = {}): ParsedTable & { headerRow: number } {
  const text = decodeCsvBuffer(buffer);
  const { records, delimiter } = parseCsvRecords(text, opts.delimiter);
  if (records.length === 0) throw new ValidationError('El archivo está vacío.');

  const headerRow = opts.headerRow ?? detectHeaderRow(records, stringifyCell);
  if (!headerRow) {
    throw new ValidationError(
      'No encontramos una fila de encabezados en las primeras 50 filas. Revisa que la primera fila tenga el nombre de cada columna.',
    );
  }
  const { headers, rows } = buildTable(records, headerRow, stringifyCell);
  return { headers, rows, totalRows: rows.length, delimiter, headerRow };
}
