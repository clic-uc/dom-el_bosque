/**
 * Fixtures en memoria para los tests de importación: CSV (UTF-8 o Windows-1252) y XLSX generado con exceljs
 * (con filas de título sobre los encabezados y una segunda hoja), más un `File` falso para `uploadImport`.
 */
import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import type { UploadFile } from '../upload';

export type Cell = string | number | boolean | Date | null;

export function csvBuffer(headers: string[], rows: Cell[][], opts: { delimiter?: string; encoding?: 'utf8' | 'win1252'; bom?: boolean } = {}): Buffer {
  const d = opts.delimiter ?? ';';
  const esc = (v: Cell) => {
    if (v === null) return '';
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[";\n,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [headers.map(esc).join(d), ...rows.map((r) => r.map(esc).join(d))].join('\r\n') + '\r\n';
  const body = opts.encoding === 'win1252' ? iconv.encode(text, 'win1252') : Buffer.from(text, 'utf8');
  return opts.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

export async function xlsxBuffer(
  headers: string[],
  rows: Cell[][],
  opts: { titleRows?: number; sheetName?: string; secondSheet?: boolean } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName ?? 'Datos');
  const titleRows = opts.titleRows ?? 2;
  if (titleRows >= 1) ws.addRow(['Listado de permisos — Dirección de Obras']);
  for (let i = 1; i < titleRows; i++) ws.addRow([]);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  if (opts.secondSheet !== false) {
    const ws2 = wb.addWorksheet('Resumen');
    ws2.addRow(['Total', rows.length]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function fakeFile(name: string, buffer: Buffer): UploadFile {
  return {
    name,
    size: buffer.byteLength,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  };
}

export function roleOf(n: number): string {
  return `${String(Math.floor(n / 100000)).padStart(5, '0')}-${String(n % 100000).padStart(5, '0')}`;
}
