import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors';
import { csvBuffer, xlsxBuffer } from './__tests__/fixtures';
import { decodeCsvBuffer, parseCsv } from './parse-csv';
import { parseXlsx, stringifyXlsxCell } from './parse-xlsx';
import { checkHeaders, columnLetter, detectHeaderRow } from './table';

describe('parseCsv (§8.5 paso 2)', () => {
  it('decodifica Windows-1252 con acentos y autodetecta ";"', () => {
    const buf = csvBuffer(['Rol', 'Dirección', 'Año'], [['4631-30', 'José Miguel Carrera 1234', 2024]], {
      delimiter: ';',
      encoding: 'win1252',
    });
    expect(decodeCsvBuffer(buf)).toContain('Dirección');
    const t = parseCsv(buf);
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['Rol', 'Dirección', 'Año']);
    expect(t.rows[0]).toEqual({
      rowNumber: 2,
      values: { Rol: '4631-30', Dirección: 'José Miguel Carrera 1234', Año: '2024' },
    });
  });

  it('quita el BOM, respeta comillas con saltos de línea y conserva la numeración de filas vacías', () => {
    const text = '﻿Rol,Obs\r\n1-1,"línea 1\r\nlínea 2"\r\n\r\n2-2,x\r\n';
    const t = parseCsv(Buffer.from(text, 'utf8'));
    expect(t.headers).toEqual(['Rol', 'Obs']);
    expect(t.delimiter).toBe(',');
    expect(t.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(t.rows[0]!.values.Obs).toBe('línea 1\r\nlínea 2');
    expect(t.totalRows).toBe(2);
  });

  it('detecta la fila de encabezados cuando hay títulos arriba y permite fijarla', () => {
    const text = 'Listado de permisos\n\nRol;Monto\n1-1;100\n';
    const t = parseCsv(Buffer.from(text));
    expect(t.headerRow).toBe(3);
    expect(t.rows[0]!.rowNumber).toBe(4);
    const fixed = parseCsv(Buffer.from('a;b\nRol;Monto\n1-1;5\n'), { headerRow: 2 });
    expect(fixed.headers).toEqual(['Rol', 'Monto']);
  });

  it('rechaza encabezados repetidos o vacíos indicando cuáles', () => {
    expect(() => parseCsv(Buffer.from('Rol;Rol;Monto\n1;2;3\n'), { headerRow: 1 })).toThrow(
      /repetidos: "Rol"/,
    );
    expect(() => parseCsv(Buffer.from('Rol;;Monto\n1;2;3\n'), { headerRow: 1 })).toThrow(
      /columna B no tiene nombre/,
    );
    expect(() => parseCsv(Buffer.from(''))).toThrow(ValidationError);
  });

  it('ignora columnas vacías al final de los encabezados', () => {
    const r = checkHeaders(['Rol', 'Monto', '', '  ']);
    expect(r).toEqual({ ok: true, headers: ['Rol', 'Monto'] });
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(26)).toBe('AA');
    expect(detectHeaderRow([['solo titulo'], ['Rol', 'Monto']], String)).toBe(2);
  });
});

describe('parseXlsx', () => {
  it('lee la primera hoja, detecta los encabezados bajo dos filas de título y tipa las celdas', async () => {
    const buf = await xlsxBuffer(
      ['Rol', 'Fecha', 'Monto', 'Pagado'],
      [
        ['4631-30', new Date(Date.UTC(2024, 2, 12)), 1234.5, true],
        [null, null, null, null],
        ['12-3', null, 7, false],
      ],
    );
    const t = await parseXlsx(buf);
    expect(t.sheets).toEqual(['Datos', 'Resumen']);
    expect(t.sheetName).toBe('Datos');
    expect(t.headerRow).toBe(3);
    expect(t.rows.map((r) => r.rowNumber)).toEqual([4, 6]);
    expect(t.rows[0]!.values).toEqual({ Rol: '4631-30', Fecha: '2024-03-12', Monto: '1234,5', Pagado: 'Sí' });
    expect(t.rows[1]!.values).toEqual({ Rol: '12-3', Fecha: '', Monto: '7', Pagado: 'No' });
  });

  it('permite elegir hoja y falla con un nombre inexistente', async () => {
    const buf = await xlsxBuffer(['A', 'B'], [[1, 2]], { titleRows: 0 });
    const t = await parseXlsx(buf, { sheetName: 'Resumen', headerRow: 1 });
    expect(t.headers).toEqual(['Total', '1']);
    await expect(parseXlsx(buf, { sheetName: 'Nada' })).rejects.toThrow(/no existe/);
  });

  it('stringifyXlsxCell: decimales con coma, enteros tal cual, sin ruido de coma flotante', () => {
    expect(stringifyXlsxCell(0.1 + 0.2)).toBe('0,3');
    expect(stringifyXlsxCell(6123)).toBe('6123');
    expect(stringifyXlsxCell(-33.546553)).toBe('-33,546553');
    expect(stringifyXlsxCell(null)).toBe('');
  });
});
