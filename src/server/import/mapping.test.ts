import { describe, expect, it } from 'vitest';
import type { LayerRow } from '../services/_shared';
import { initialResolution, validateMapping } from './analysis';
import { buildSuggestedMapping } from './upload';

const layer: LayerRow = {
  id: 1,
  slug: 'obras-menores',
  name: 'Obras Menores',
  department: 'edificacion',
  hasRole: true,
  fields: [
    { key: 'n_permiso', label: 'N° Permiso', type: 'number', required: true, options: {} },
    { key: 'direccion', label: 'Dirección', type: 'string', required: false, options: {} },
    { key: 'fecha', label: 'Fecha', type: 'date', required: false, options: {} },
  ],
  uniqueKeys: ['n_permiso'],
  addressFieldKey: 'direccion',
  heatmapFieldKey: null,
  icon: 'building-2',
  iconColor: '#3b82f6',
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const base = {
  duplicateStrategy: 'ask' as const,
  keepExistingOnEmpty: true,
  geocode: true,
  fullReplace: false,
};

describe('buildSuggestedMapping (§10.2 paso 2)', () => {
  it('mapea por label/key sin importar mayúsculas ni acentos, alias de rol y lat/lon', () => {
    const m = buildSuggestedMapping(
      ['ROL SII', 'n° permiso', 'DIRECCION', 'Latitud', 'lng', 'Observaciones', 'Otra'],
      layer,
    );
    expect(m).toEqual({
      'ROL SII': 'roleId',
      'n° permiso': 'n_permiso',
      DIRECCION: 'direccion',
      Latitud: 'lat',
      lng: 'lon',
      Observaciones: 'comments',
      Otra: null,
    });
  });

  it('no repite destinos y no sugiere rol en capas sin rol', () => {
    const m = buildSuggestedMapping(['Rol', 'rol', 'Fecha'], { ...layer, hasRole: false });
    expect(m).toEqual({ Rol: null, rol: null, Fecha: 'fecha' });
    const m2 = buildSuggestedMapping(['N° Permiso', 'n_permiso'], layer);
    expect(m2).toEqual({ 'N° Permiso': 'n_permiso', n_permiso: null });
  });
});

describe('validateMapping (§8.5 "Analizar" paso 1)', () => {
  it('exige rol o dirección en capas con rol', () => {
    expect(() => validateMapping(layer, { ...base, columnMapping: { A: 'n_permiso' } })).toThrow(
      /Rol SII o la del campo de dirección/,
    );
    expect(() =>
      validateMapping(layer, { ...base, columnMapping: { A: 'n_permiso', B: 'direccion' } }),
    ).not.toThrow();
  });

  it('exige los campos requeridos, lat/lon juntos y destinos sin repetir', () => {
    expect(() => validateMapping(layer, { ...base, columnMapping: { A: 'roleId' } })).toThrow(
      /requerido "N° Permiso"/,
    );
    expect(() =>
      validateMapping(layer, { ...base, columnMapping: { A: 'roleId', B: 'n_permiso', C: 'lat' } }),
    ).toThrow(/Latitud y longitud/);
    expect(() =>
      validateMapping(layer, { ...base, columnMapping: { A: 'roleId', B: 'n_permiso', C: 'n_permiso' } }),
    ).toThrow(/mismo destino/);
    expect(() =>
      validateMapping(layer, { ...base, columnMapping: { A: 'roleId', B: 'n_permiso', C: 'inexistente' } }),
    ).toThrow(/no es un campo/);
  });

  it('reemplazo completo: requiere campos únicos mapeados y sin rango', () => {
    expect(() =>
      validateMapping(
        { ...layer, uniqueKeys: [] },
        { ...base, fullReplace: true, columnMapping: { A: 'roleId', B: 'n_permiso' } },
      ),
    ).toThrow(/campos únicos/);
    expect(() =>
      validateMapping(layer, {
        ...base,
        fullReplace: true,
        rowFrom: 2,
        columnMapping: { A: 'roleId', B: 'n_permiso' },
      }),
    ).toThrow(/rango/);
    expect(() =>
      validateMapping(layer, { ...base, fullReplace: true, columnMapping: { A: 'roleId', B: 'n_permiso' } }),
    ).not.toThrow();
  });

  it('rechaza columnas que no existen en el archivo', () => {
    expect(() =>
      validateMapping(layer, { ...base, columnMapping: { A: 'roleId', B: 'n_permiso' } }, ['A']),
    ).toThrow(/no existe en el archivo/);
  });
});

describe('initialResolution (§8.5 paso 3)', () => {
  it('skip omite todo; update solo con un único existente; ask deja sin resolver', () => {
    const dup = { status: 'duplicate' as const, duplicateOf: [7], fileDuplicateOf: null };
    expect(initialResolution(dup, 'skip')).toEqual({ resolution: 'skip', updateTargetId: null });
    expect(initialResolution(dup, 'update')).toEqual({ resolution: 'update', updateTargetId: 7 });
    expect(initialResolution(dup, 'ask')).toEqual({ resolution: null, updateTargetId: null });
    expect(initialResolution({ ...dup, duplicateOf: [7, 8] }, 'update')).toEqual({
      resolution: null,
      updateTargetId: null,
    });
    expect(initialResolution({ ...dup, duplicateOf: [], fileDuplicateOf: 4 }, 'update')).toEqual({
      resolution: null,
      updateTargetId: null,
    });
    expect(initialResolution({ status: 'valid', duplicateOf: [], fileDuplicateOf: null }, 'skip')).toEqual({
      resolution: null,
      updateTargetId: null,
    });
  });
});
