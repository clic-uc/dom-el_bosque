import { restoreFormulaText } from '../csv';
import { ValidationError } from '../errors';

/**
 * Representación común de una planilla leída (CSV o XLSX) para la importación (§8.5).
 * Los `rowNumber` son siempre los de la planilla tal como los ve el usuario en Excel (1 = primera fila).
 */

export type TableRow = { rowNumber: number; values: Record<string, string> };

export type ParsedTable = {
  headers: string[];
  /** Filas de datos con contenido (las vacías no cuentan, pero sí conservan la numeración). */
  totalRows: number;
  rows: TableRow[];
  /** Solo CSV: delimitador usado (detectado o fijado). */
  delimiter?: string;
  /** Solo XLSX. */
  sheets?: string[];
  sheetName?: string;
  /** Solo KML/KMZ: marcadores que no son un punto (áreas, líneas, sin ubicación) y no se importan. */
  skippedFeatures?: number;
};

export type CellStringifier = (v: unknown) => string;

/**
 * Texto de una celda, sin el `'` que la exportación antepone a lo que una planilla leería como fórmula: así un
 * CSV descargado de la plataforma (de una capa o de filas con errores) se puede volver a subir tal cual.
 */
const cellText =
  (stringify: CellStringifier): CellStringifier =>
  (v) =>
    restoreFormulaText(stringify(v));

/** Letra de columna estilo Excel (0 → A, 26 → AA). */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Quita las celdas vacías del final de la fila de encabezados (Excel suele exportar columnas de más). */
function trimTrailingEmpty(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1]!.trim() === '') end--;
  return cells.slice(0, end);
}

export type HeaderCheck = { ok: true; headers: string[] } | { ok: false; message: string };

/** Valida la fila de encabezados: sin vacíos intermedios ni repetidos, al menos una columna. */
export function checkHeaders(cells: string[]): HeaderCheck {
  const headers = trimTrailingEmpty(cells.map((c) => c.trim()));
  if (headers.length === 0) {
    return {
      ok: false,
      message:
        'La fila de encabezados está vacía. Indica cuál es la fila que tiene los nombres de las columnas.',
    };
  }
  const empties = headers
    .map((h, i) => (h === '' ? columnLetter(i) : null))
    .filter((x): x is string => x !== null);
  if (empties.length) {
    return {
      ok: false,
      message:
        empties.length === 1
          ? `La columna ${empties[0]} no tiene nombre en la fila de encabezados. Escríbele un nombre en el archivo o elige otra fila de encabezados.`
          : `Las columnas ${empties.join(', ')} no tienen nombre en la fila de encabezados. Escríbeles un nombre en el archivo o elige otra fila de encabezados.`,
    };
  }
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const h of headers) {
    const k = h.toLowerCase();
    if (seen.has(k)) dupes.add(h);
    seen.add(k);
  }
  if (dupes.size) {
    const list = [...dupes].map((d) => `"${d}"`).join(', ');
    return {
      ok: false,
      message: `Hay encabezados repetidos: ${list}. Cada columna debe tener un nombre distinto.`,
    };
  }
  return { ok: true, headers };
}

/**
 * Busca la fila de encabezados entre las 50 primeras: la primera con al menos 2 celdas con texto. Las filas de
 * título (una sola celda) se saltan. Si esa fila tiene encabezados repetidos o vacíos intermedios, se informa
 * cuáles (ValidationError) en vez de seguir buscando y tomar una fila de datos como encabezados.
 */
export function detectHeaderRow(
  records: readonly (readonly unknown[])[],
  stringify: CellStringifier,
  limit = 50,
): number | null {
  const text = cellText(stringify);
  const max = Math.min(records.length, limit);
  for (let i = 0; i < max; i++) {
    const cells = (records[i] ?? []).map(text);
    const nonEmpty = cells.filter((c) => c.trim() !== '').length;
    if (nonEmpty < 2) continue;
    const check = checkHeaders(cells);
    if (check.ok) return i + 1;
    throw new ValidationError(`Fila ${i + 1}: ${check.message}`);
  }
  return null;
}

/** Arma la tabla a partir de las filas crudas y la fila de encabezados elegida (1-based). */
export function buildTable(
  records: readonly (readonly unknown[])[],
  headerRow: number,
  stringify: CellStringifier,
): { headers: string[]; rows: TableRow[] } {
  if (headerRow < 1 || headerRow > records.length) {
    throw new ValidationError(
      `La fila de encabezados ${headerRow} no existe: el archivo tiene ${records.length} fila${records.length === 1 ? '' : 's'}.`,
    );
  }
  const text = cellText(stringify);
  const headerCells = (records[headerRow - 1] ?? []).map(text);
  const check = checkHeaders(headerCells);
  if (!check.ok) throw new ValidationError(check.message);
  const headers = check.headers;

  const rows: TableRow[] = [];
  for (let i = headerRow; i < records.length; i++) {
    const record = records[i] ?? [];
    const values: Record<string, string> = {};
    let hasContent = false;
    for (let c = 0; c < headers.length; c++) {
      const s = text(record[c]);
      if (s.trim() !== '') hasContent = true;
      values[headers[c]!] = s;
    }
    if (!hasContent) continue;
    rows.push({ rowNumber: i + 1, values });
  }
  return { headers, rows };
}
