import { describe, expect, it } from 'vitest';
import { createLayerSchema, layerFieldsSchema } from './layers';

const f = (key: string, type: 'string' | 'number' | 'autonumber' = 'string', options = {}) => ({
  key,
  label: key,
  type,
  required: false,
  options,
});

describe('layerFieldsSchema (§5.2)', () => {
  it('rechaza claves duplicadas y reservadas', () => {
    expect(layerFieldsSchema.safeParse([f('a'), f('a')]).success).toBe(false);
    expect(layerFieldsSchema.safeParse([f('id')]).success).toBe(false);
    expect(layerFieldsSchema.safeParse([f('roleId' as string)]).success).toBe(false);
  });

  it('solo un correlativo por capa', () => {
    expect(layerFieldsSchema.safeParse([f('a', 'autonumber'), f('b', 'autonumber')]).success).toBe(false);
    expect(layerFieldsSchema.safeParse([f('a', 'autonumber')]).success).toBe(true);
  });

  it('correlativo anual exige campo de año', () => {
    expect(layerFieldsSchema.safeParse([f('res', 'autonumber', { reset: 'yearly' })]).success).toBe(false);
    expect(
      layerFieldsSchema.safeParse([f('res', 'autonumber', { reset: 'yearly', yearFieldKey: 'anio' }), f('anio', 'number')])
        .success,
    ).toBe(true);
  });

  it('claves con formato válido', () => {
    expect(layerFieldsSchema.safeParse([f('N Permiso')]).success).toBe(false);
    expect(layerFieldsSchema.safeParse([f('n_permiso')]).success).toBe(true);
  });
});

describe('createLayerSchema', () => {
  it('uniqueKeys / addressFieldKey / heatmapFieldKey deben referenciar campos existentes y del tipo correcto', () => {
    const base = { name: 'Obras', department: 'edificacion' as const, fields: [f('dir'), f('m2', 'number')] };
    expect(createLayerSchema.safeParse({ ...base, uniqueKeys: ['dir'] }).success).toBe(true);
    expect(createLayerSchema.safeParse({ ...base, uniqueKeys: ['nope'] }).success).toBe(false);
    expect(createLayerSchema.safeParse({ ...base, addressFieldKey: 'dir' }).success).toBe(true);
    expect(createLayerSchema.safeParse({ ...base, addressFieldKey: 'm2' }).success).toBe(false);
    expect(createLayerSchema.safeParse({ ...base, heatmapFieldKey: 'm2' }).success).toBe(true);
    expect(createLayerSchema.safeParse({ ...base, heatmapFieldKey: 'dir' }).success).toBe(false);
  });

  it('aplica defaults', () => {
    const r = createLayerSchema.parse({ name: 'X', department: 'vivienda' });
    expect(r.icon).toBe('building-2');
    expect(r.fields).toEqual([]);
    expect(r.hasRole).toBe(false);
  });
});
