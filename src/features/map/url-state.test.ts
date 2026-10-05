import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
let currentSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/map',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import {
  applyToggleOverlay,
  applyWorkingLayer,
  countActiveFilters,
  EMPTY_MAP_URL_STATE,
  mapUrlStateToHref,
  parseMapUrlState,
  serializeMapUrlState,
  useMapUrlState,
} from './url-state';

describe('parseMapUrlState', () => {
  it('lee todas las claves de §10.2', () => {
    const sp = new URLSearchParams(
      'layer=3&overlays=4,5,4&view=table&record=12&role=00050-00001&polygon=7&polys=comuna,sector,otro' +
        '&heat=value&heatLayers=3,5&q=hola&f[estado]=Aprobado&f[estado]=&f[anio]=2024&loc=approx&num=without' +
        '&page=2&pageSize=100&sort=attr:n_permiso&dir=asc',
    );
    const s = parseMapUrlState(sp);
    expect(s.layer).toBe(3);
    expect(s.overlays).toEqual([4, 5]);
    expect(s.view).toBe('table');
    expect(s.record).toBe(12);
    expect(s.role).toBe('00050-00001');
    expect(s.polygon).toBe(7);
    expect(s.polys).toEqual(['comuna', 'sector']);
    expect(s.heat).toBe('value');
    expect(s.heatLayers).toEqual([3, 5]);
    expect(s.q).toBe('hola');
    expect(s.filters).toEqual({ estado: ['Aprobado', ''], anio: ['2024'] });
    expect(s.loc).toBe('approx');
    expect(s.num).toBe('without');
    expect(s.page).toBe(2);
    expect(s.pageSize).toBe(100);
    expect(s.sort).toBe('attr:n_permiso');
    expect(s.dir).toBe('asc');
  });

  it('descarta valores inválidos y vuelve a los defaults', () => {
    const s = parseMapUrlState(
      new URLSearchParams('layer=abc&view=x&role=12-3&heat=foo&page=-1&pageSize=33&sort=drop%20table&dir=up&f[Bad Key]=1'),
    );
    expect(s).toEqual(EMPTY_MAP_URL_STATE);
  });

  it('limita las capas superpuestas a 6', () => {
    const s = parseMapUrlState(new URLSearchParams('overlays=1,2,3,4,5,6,7,8'));
    expect(s.overlays).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('serializeMapUrlState', () => {
  it('omite los defaults', () => {
    expect(serializeMapUrlState(EMPTY_MAP_URL_STATE).toString()).toBe('');
    expect(mapUrlStateToHref('/map', EMPTY_MAP_URL_STATE)).toBe('/map');
  });

  it('es inversa de parse (ida y vuelta)', () => {
    const state = {
      ...EMPTY_MAP_URL_STATE,
      layer: 3,
      overlays: [4, 5],
      view: 'table' as const,
      role: '00050-00001',
      polys: ['comuna' as const],
      heat: 'density' as const,
      heatLayers: [3],
      q: 'calle 123',
      filters: { estado: ['Aprobado', ''], anio: ['2024'] },
      loc: 'none' as const,
      num: 'with' as const,
      page: 3,
      pageSize: 25,
      sort: 'roleId',
      dir: 'asc' as const,
    };
    const qs = serializeMapUrlState(state);
    expect(parseMapUrlState(qs)).toEqual(state);
  });

  it('no escribe heatLayers si el calor está apagado', () => {
    const qs = serializeMapUrlState({ ...EMPTY_MAP_URL_STATE, heat: null, heatLayers: [3] });
    expect(qs.has('heatLayers')).toBe(false);
  });
});

describe('transiciones puras', () => {
  it('cambiar la capa de trabajo limpia búsqueda, filtros y registro abierto', () => {
    const before = {
      ...EMPTY_MAP_URL_STATE,
      layer: 1,
      overlays: [2, 3],
      record: 9,
      role: '00001-00002',
      q: 'x',
      filters: { a: ['1'] },
      loc: 'none' as const,
      page: 4,
      sort: 'lat',
      dir: 'asc' as const,
    };
    const after = applyWorkingLayer(before, 2);
    expect(after.layer).toBe(2);
    expect(after.overlays).toEqual([3]);
    expect(after.record).toBeNull();
    expect(after.role).toBe('00001-00002');
    expect(after.q).toBe('');
    expect(after.filters).toEqual({});
    expect(after.loc).toBeNull();
    expect(after.page).toBe(1);
    expect(after.sort).toBe('updatedAt');
  });

  it('no superpone la capa de trabajo ni más de 6 capas', () => {
    const s = { ...EMPTY_MAP_URL_STATE, layer: 1, overlays: [2, 3, 4, 5, 6, 7] };
    expect(applyToggleOverlay(s, 1)).toBe(s);
    expect(applyToggleOverlay(s, 8)).toBe(s);
    expect(applyToggleOverlay(s, 7).overlays).toEqual([2, 3, 4, 5, 6]);
    expect(applyToggleOverlay({ ...s, overlays: [2] }, 3).overlays).toEqual([2, 3]);
  });

  it('cuenta los filtros activos', () => {
    expect(countActiveFilters({ filters: { a: ['1'], b: [] }, loc: 'approx', num: null })).toBe(2);
  });
});

describe('useMapUrlState', () => {
  beforeEach(() => {
    replace.mockClear();
    currentSearch = 'layer=1&overlays=2';
  });

  it('expone el estado parseado y escribe con router.replace sin scroll', () => {
    const { result } = renderHook(() => useMapUrlState());
    expect(result.current.state.layer).toBe(1);
    act(() => result.current.openRecord(42));
    expect(replace).toHaveBeenCalledWith('/map?layer=1&overlays=2&record=42', { scroll: false });
  });

  it('encadena setters en el mismo tick partiendo del último estado escrito', () => {
    const { result } = renderHook(() => useMapUrlState());
    act(() => {
      result.current.openRecord(42);
      result.current.setView('table');
    });
    expect(replace).toHaveBeenLastCalledWith('/map?layer=1&overlays=2&view=table&record=42', { scroll: false });
  });

  it('cambiar de capa limpia filtros y búsqueda', () => {
    currentSearch = 'layer=1&q=hola&f[a]=1&record=3';
    const { result } = renderHook(() => useMapUrlState());
    act(() => result.current.setWorkingLayer(2));
    expect(replace).toHaveBeenLastCalledWith('/map?layer=2', { scroll: false });
  });
});
