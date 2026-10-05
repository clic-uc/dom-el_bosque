import { describe, expect, it } from 'vitest';
import { initials, normalizeText, slugify, toFieldKey, uniqueSuffix } from './text';

describe('text utils', () => {
  it('toFieldKey', () => {
    expect(toFieldKey('N° Permiso')).toBe('n_permiso');
    expect(toFieldKey('Población / Villa')).toBe('poblacion_villa');
    expect(toFieldKey('M2 Terreno')).toBe('m2_terreno');
    expect(toFieldKey('2024')).toBe('c_2024');
    expect(toFieldKey('N')).toBe('n');
  });
  it('slugify', () => {
    expect(slugify('Obras Menores')).toBe('obras-menores');
    expect(slugify('Ley 19.583')).toBe('ley-19-583');
    expect(slugify('Actividades Comerciales e Industrias con Riesgo')).toBe(
      'actividades-comerciales-e-industrias-con-riesgo',
    );
  });
  it('uniqueSuffix', () => {
    expect(uniqueSuffix('a', ['b'])).toBe('a');
    expect(uniqueSuffix('a', ['a'])).toBe('a_2');
    expect(uniqueSuffix('a', ['a', 'a_2'])).toBe('a_3');
    expect(uniqueSuffix('x', ['x'], '-')).toBe('x-2');
  });
  it('normalizeText', () => {
    expect(normalizeText('  Ñuñoa   CENTRO ')).toBe('nunoa centro');
  });
  it('initials', () => {
    expect(initials('María Pérez')).toBe('MP');
    expect(initials('Ana')).toBe('AN');
  });
});
