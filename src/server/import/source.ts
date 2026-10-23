import type { imports } from '@/db/schema';
import { ConflictError } from '../errors';
import { storage } from '../storage';
import { parseCsv } from './parse-csv';
import { parseKml, parseKmz } from './parse-kml';
import { parseXlsx } from './parse-xlsx';
import type { ParsedTable } from './table';

export type ImportRow = typeof imports.$inferSelect;

export function importFileKey(importId: string): string {
  return `imports/${importId}`;
}

export type SourceOverrides = {
  sheetName?: string | null;
  headerRow?: number | null;
  delimiter?: string | null;
};

/** Lee la planilla de una importación con sus opciones actuales (hoja, fila de encabezados, delimitador). */
export async function readImportTable(
  imp: Pick<ImportRow, 'fileKey' | 'fileType' | 'sheetName' | 'headerRow' | 'delimiter'>,
  overrides: SourceOverrides = {},
): Promise<ParsedTable & { headerRow: number }> {
  if (!imp.fileKey || !(await storage.exists(imp.fileKey))) {
    throw new ConflictError('El archivo de esta importación ya no está disponible. Vuelve a subirlo.');
  }
  const buffer = await storage.get(imp.fileKey);
  return parseImportBuffer(buffer, imp, overrides);
}

/** Interpreta el contenido de una planilla (también antes de guardarla, al subirla). */
export async function parseImportBuffer(
  buffer: Buffer,
  imp: Pick<ImportRow, 'fileType' | 'sheetName' | 'headerRow' | 'delimiter'>,
  overrides: SourceOverrides = {},
): Promise<ParsedTable & { headerRow: number }> {
  // `null` = volver a detectar la fila de encabezados; `undefined` = usar la guardada.
  const headerRow = overrides.headerRow === undefined ? imp.headerRow : overrides.headerRow;
  if (imp.fileType === 'xlsx') {
    return parseXlsx(buffer, { sheetName: overrides.sheetName ?? imp.sheetName, headerRow });
  }
  if (imp.fileType === 'kml') return parseKml(buffer);
  if (imp.fileType === 'kmz') return parseKmz(buffer);
  return parseCsv(buffer, { delimiter: overrides.delimiter ?? imp.delimiter, headerRow });
}
