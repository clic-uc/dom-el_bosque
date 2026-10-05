import readXlsxFile from 'read-excel-file/node';
import { ValidationError } from '../errors';
import { buildTable, detectHeaderRow, type ParsedTable } from './table';

/**
 * Lectura de XLSX con `read-excel-file` (§8.5 paso 2). Las celdas llegan tipadas (string, number, boolean, Date);
 * las convertimos a texto de forma que `castValue` las vuelva a interpretar igual:
 *  - Date → 'aaaa-mm-dd'
 *  - número → entero tal cual; decimal con coma ('1234,5'), como lo ve un usuario chileno
 *  - boolean → 'Sí' / 'No'
 *  - vacío → ''
 */

export function stringifyXlsxCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    const clean = Number(v.toPrecision(15));
    return Number.isInteger(clean) ? String(clean) : String(clean).replace('.', ',');
  }
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
}

export type ParseXlsxOptions = {
  sheetName?: string | null;
  headerRow?: number | null;
};

export async function parseXlsx(
  buffer: Buffer,
  opts: ParseXlsxOptions = {},
): Promise<ParsedTable & { headerRow: number }> {
  let all: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    all = await readXlsxFile(buffer);
  } catch {
    throw new ValidationError('No pudimos leer el archivo Excel. Guárdalo como .xlsx desde Excel e intenta de nuevo.');
  }
  const sheets = all.map((s) => s.sheet);
  if (sheets.length === 0) throw new ValidationError('El archivo Excel no tiene hojas.');

  const target = opts.sheetName ? all.find((s) => s.sheet === opts.sheetName) : all[0];
  if (!target) {
    throw new ValidationError(`La hoja "${opts.sheetName}" no existe. Hojas disponibles: ${sheets.join(', ')}.`);
  }
  const records = target.data as unknown[][];
  if (records.length === 0) throw new ValidationError(`La hoja "${target.sheet}" está vacía.`);

  const headerRow = opts.headerRow ?? detectHeaderRow(records, stringifyXlsxCell);
  if (!headerRow) {
    throw new ValidationError(
      `No encontramos una fila de encabezados en las primeras 50 filas de la hoja "${target.sheet}". Revisa que una fila tenga el nombre de cada columna.`,
    );
  }
  const { headers, rows } = buildTable(records, headerRow, stringifyXlsxCell);
  return { headers, rows, totalRows: rows.length, sheets, sheetName: target.sheet, headerRow };
}
