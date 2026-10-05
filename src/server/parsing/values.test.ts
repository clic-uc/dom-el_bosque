import { describe, expect, it } from 'vitest';
import type { LayerField } from '@/shared/schemas/layers';
import { castAttributes, castValue, parseDateToIso, parseNumberCl, previewTypeConversion } from './values';

describe('parseNumberCl', () => {
  it('acepta formatos chilenos e internacionales', () => {
    expect(parseNumberCl('1.234,5')).toBe(1234.5);
    expect(parseNumberCl('1234.5')).toBe(1234.5);
    expect(parseNumberCl('1,234.5')).toBe(1234.5);
    expect(parseNumberCl('1.234.567')).toBe(1234567);
    expect(parseNumberCl('1.234')).toBe(1234);
    expect(parseNumberCl('12,5')).toBe(12.5);
    expect(parseNumberCl('$ 1.500')).toBe(1500);
    expect(parseNumberCl(42)).toBe(42);
    expect(parseNumberCl('abc')).toBeNull();
  });
});

describe('parseDateToIso', () => {
  it('acepta dd-mm-aaaa, dd/mm/aaaa, ISO, Date y seriales de Excel', () => {
    expect(parseDateToIso('05-03-2024')).toBe('2024-03-05');
    expect(parseDateToIso('5/3/2024')).toBe('2024-03-05');
    expect(parseDateToIso('2024-03-05')).toBe('2024-03-05');
    expect(parseDateToIso('2024-03-05T10:00:00Z')).toBe('2024-03-05');
    expect(parseDateToIso(new Date(Date.UTC(2024, 2, 5)))).toBe('2024-03-05');
    expect(parseDateToIso(45356)).toBe('2024-03-05');
    expect(parseDateToIso('31-02-2024')).toBeNull();
    expect(parseDateToIso('ayer')).toBeNull();
  });
});

describe('castValue', () => {
  it('string', () => {
    expect(castValue('  hola ', 'string')).toEqual({ ok: true, value: 'hola' });
    expect(castValue('', 'string')).toEqual({ ok: true, value: null });
  });
  it('number / autonumber', () => {
    expect(castValue('1.234,5', 'number')).toEqual({ ok: true, value: 1234.5 });
    expect(castValue('x', 'number')).toMatchObject({ ok: false });
    expect(castValue('6124', 'autonumber')).toEqual({ ok: true, value: 6124 });
    expect(castValue('61,5', 'autonumber')).toMatchObject({ ok: false });
    expect(castValue('-3', 'autonumber')).toMatchObject({ ok: false });
  });
  it('boolean', () => {
    expect(castValue('sí', 'boolean')).toEqual({ ok: true, value: true });
    expect(castValue('NO', 'boolean')).toEqual({ ok: true, value: false });
    expect(castValue('x', 'boolean')).toEqual({ ok: true, value: true });
    expect(castValue('quizás', 'boolean')).toMatchObject({ ok: false });
  });
  it('date', () => {
    expect(castValue('12/03/2024', 'date')).toEqual({ ok: true, value: '2024-03-12' });
    expect(castValue('hoy', 'date')).toMatchObject({ ok: false });
  });
});

describe('castAttributes', () => {
  const fields: LayerField[] = [
    { key: 'direccion', label: 'Dirección', type: 'string', required: false, options: {} },
    { key: 'm2', label: 'M2', type: 'number', required: false, options: {} },
    { key: 'n_permiso', label: 'N° Permiso', type: 'autonumber', required: false, options: {} },
  ];

  it('filtra claves desconocidas, castea y omite el correlativo en formularios', () => {
    const r = castAttributes({ direccion: ' Riquelme 111 ', m2: '45,5', n_permiso: '10', otra: 1 }, fields);
    expect(r.attributes).toEqual({ direccion: 'Riquelme 111', m2: 45.5 });
    expect(r.unknownKeys).toEqual(['otra']);
    expect(r.errors).toEqual([]);
  });

  it('acepta el correlativo en importación', () => {
    const r = castAttributes({ n_permiso: '10' }, fields, { allowAutonumber: true });
    expect(r.attributes).toEqual({ n_permiso: 10 });
  });

  it('reporta errores con la etiqueta del campo', () => {
    const r = castAttributes({ m2: 'muchos' }, fields);
    expect(r.errors[0]).toMatchObject({ key: 'm2', label: 'M2' });
  });
});

describe('previewTypeConversion (§7.2)', () => {
  it('cuenta convertibles y ejemplos de los que no', () => {
    const r = previewTypeConversion(['1', '2,5', 'x', null, ''], 'number');
    expect(r).toEqual({ convertible: 2, notConvertible: 1, samples: ['x'] });
  });
});
