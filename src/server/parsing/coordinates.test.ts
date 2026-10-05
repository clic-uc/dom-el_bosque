import { describe, expect, it } from 'vitest';
import { isInsideComuna, parseCoordinate, parseCoordinatePair } from './coordinates';

describe('parseCoordinate (§8.2)', () => {
  it('vacío o cero → null', () => {
    expect(parseCoordinate('', 'lat')).toEqual({ ok: true, value: null });
    expect(parseCoordinate('0', 'lat')).toEqual({ ok: true, value: null });
    expect(parseCoordinate(0, 'lon')).toEqual({ ok: true, value: null });
    expect(parseCoordinate(null, 'lon')).toEqual({ ok: true, value: null });
  });

  it('parseo normal con punto o coma', () => {
    expect(parseCoordinate('-33.546553', 'lat')).toEqual({ ok: true, value: -33.546553 });
    expect(parseCoordinate('-70,666563', 'lon')).toEqual({ ok: true, value: -70.666563 });
    expect(parseCoordinate(-33.5, 'lat')).toEqual({ ok: true, value: -33.5 });
  });

  it('heurística legacy solo con más de un separador o fuera de rango', () => {
    expect(parseCoordinate('-33.546.553', 'lat')).toEqual({ ok: true, value: -33.546553 });
    expect(parseCoordinate('-70.456.345', 'lon')).toEqual({ ok: true, value: -70.456345 });
    expect(parseCoordinate('-33546553', 'lat')).toEqual({ ok: true, value: -33.546553 });
    expect(parseCoordinate(-70666563, 'lon')).toEqual({ ok: true, value: -70.666563 });
    // el error del legacy: "-3.5" NO debe convertirse en 35
    expect(parseCoordinate('-3.5', 'lat')).toEqual({ ok: true, value: -3.5 });
  });

  it('redondea a 6 decimales', () => {
    expect(parseCoordinate('-33.5465531234', 'lat')).toEqual({ ok: true, value: -33.546553 });
  });

  it('fuera de rango → error', () => {
    expect(parseCoordinate('abc', 'lat')).toMatchObject({ ok: false });
    expect(parseCoordinate('95', 'lat')).toMatchObject({ ok: false });
  });
});

describe('parseCoordinatePair', () => {
  it('ambos o ninguno', () => {
    expect(parseCoordinatePair('', '')).toEqual({ ok: true, lat: null, lon: null });
    expect(parseCoordinatePair('-33.5', '')).toMatchObject({ ok: false });
  });

  it('advierte fuera de la comuna sin rechazar', () => {
    expect(parseCoordinatePair('-33.546553', '-70.666563')).toEqual({ ok: true, lat: -33.546553, lon: -70.666563 });
    expect(parseCoordinatePair('-33.45', '-70.66')).toMatchObject({ ok: true, warning: 'outside_comuna' });
    expect(isInsideComuna(-33.56, -70.66)).toBe(true);
    expect(isInsideComuna(-33.0, -70.66)).toBe(false);
  });
});
