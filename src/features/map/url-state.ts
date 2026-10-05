'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { DEFAULT_PAGE_SIZE, MAX_OVERLAY_LAYERS, PAGE_SIZES, polygonKinds, type PolygonKind } from '@/shared/constants';

/**
 * Estado del espacio de trabajo `/map` en la URL (§10.2), para que cualquier vista sea compartible:
 * `?layer=3&overlays=4,5&view=table&record=12&role=00050-00001&polygon=7&polys=comuna,sector
 *  &heat=value&heatLayers=3,5&q=texto&f[campo]=valor&loc=none&num=without&page=2&pageSize=100&sort=attr:n_permiso&dir=asc`
 */

export type MapView = 'map' | 'table';
export type HeatMode = 'density' | 'value';
/** Filtro de ubicación: todas (null) / sin coordenadas / aproximadas por dirección. */
export type LocationFilter = 'none' | 'approx';
/** Filtro del correlativo: con número / sin número. */
export type NumberFilter = 'with' | 'without';
export type SortDir = 'asc' | 'desc';

export type MapUrlState = {
  /** Capa de trabajo. */
  layer: number | null;
  /** Capas superpuestas (solo dibujo). */
  overlays: number[];
  view: MapView;
  record: number | null;
  role: string | null;
  polygon: number | null;
  polys: PolygonKind[];
  heat: HeatMode | null;
  heatLayers: number[];
  /** Texto de búsqueda (en vista tabla también filtra la tabla). */
  q: string;
  /** Filtros por campo de la capa de trabajo (`f[campo]=valor`, repetible). */
  filters: Record<string, string[]>;
  loc: LocationFilter | null;
  num: NumberFilter | null;
  page: number;
  pageSize: number;
  sort: string;
  dir: SortDir;
};

export const DEFAULT_SORT = 'updatedAt';
export const DEFAULT_DIR: SortDir = 'desc';

export const EMPTY_MAP_URL_STATE: MapUrlState = {
  layer: null,
  overlays: [],
  view: 'map',
  record: null,
  role: null,
  polygon: null,
  polys: [],
  heat: null,
  heatLayers: [],
  q: '',
  filters: {},
  loc: null,
  num: null,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sort: DEFAULT_SORT,
  dir: DEFAULT_DIR,
};

const FILTER_KEY = /^f\[([a-z][a-z0-9_]*)\]$/;
const SORT_RE = /^(id|roleId|lat|lon|updatedAt|createdAt|attr:[a-z][a-z0-9_]*)$/;
const ROLE_RE = /^\d{5}-\d{5}$/;

function parseId(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseIdList(v: string | null, max?: number): number[] {
  if (!v) return [];
  const out: number[] = [];
  for (const part of v.split(',')) {
    const n = parseId(part.trim());
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return max ? out.slice(0, max) : out;
}

type ReadonlyParams = Pick<URLSearchParams, 'get' | 'getAll' | 'entries'>;

/** Lee el estado desde los search params. Nunca lanza: lo inválido se descarta y vuelve al valor por defecto. */
export function parseMapUrlState(sp: ReadonlyParams): MapUrlState {
  const view = sp.get('view');
  const heat = sp.get('heat');
  const loc = sp.get('loc');
  const num = sp.get('num');
  const dir = sp.get('dir');
  const sort = sp.get('sort');
  const role = sp.get('role');
  const pageSize = Number(sp.get('pageSize'));
  const page = Number(sp.get('page'));

  const filters: Record<string, string[]> = {};
  for (const [key, value] of sp.entries()) {
    const m = FILTER_KEY.exec(key);
    if (!m) continue;
    const field = m[1]!;
    const list = filters[field] ?? (filters[field] = []);
    if (!list.includes(value)) list.push(value);
  }

  const polys: PolygonKind[] = [];
  for (const part of (sp.get('polys') ?? '').split(',')) {
    const k = part.trim();
    if ((polygonKinds as readonly string[]).includes(k) && !polys.includes(k as PolygonKind)) polys.push(k as PolygonKind);
  }

  return {
    layer: parseId(sp.get('layer')),
    overlays: parseIdList(sp.get('overlays'), MAX_OVERLAY_LAYERS),
    view: view === 'table' ? 'table' : 'map',
    record: parseId(sp.get('record')),
    role: role && ROLE_RE.test(role) ? role : null,
    polygon: parseId(sp.get('polygon')),
    polys,
    heat: heat === 'density' || heat === 'value' ? heat : null,
    heatLayers: parseIdList(sp.get('heatLayers')),
    q: sp.get('q') ?? '',
    filters,
    loc: loc === 'none' || loc === 'approx' ? loc : null,
    num: num === 'with' || num === 'without' ? num : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    sort: sort && SORT_RE.test(sort) ? sort : DEFAULT_SORT,
    dir: dir === 'asc' ? 'asc' : DEFAULT_DIR,
  };
}

/** Serializa omitiendo los valores por defecto, para URLs cortas y estables. */
export function serializeMapUrlState(state: MapUrlState): URLSearchParams {
  const sp = new URLSearchParams();
  if (state.layer !== null) sp.set('layer', String(state.layer));
  if (state.overlays.length) sp.set('overlays', state.overlays.join(','));
  if (state.view !== 'map') sp.set('view', state.view);
  if (state.record !== null) sp.set('record', String(state.record));
  if (state.role !== null) sp.set('role', state.role);
  if (state.polygon !== null) sp.set('polygon', String(state.polygon));
  if (state.polys.length) sp.set('polys', state.polys.join(','));
  if (state.heat) sp.set('heat', state.heat);
  if (state.heat && state.heatLayers.length) sp.set('heatLayers', state.heatLayers.join(','));
  if (state.q) sp.set('q', state.q);
  for (const key of Object.keys(state.filters).sort()) {
    for (const v of state.filters[key] ?? []) sp.append(`f[${key}]`, v);
  }
  if (state.loc) sp.set('loc', state.loc);
  if (state.num) sp.set('num', state.num);
  if (state.page > 1) sp.set('page', String(state.page));
  if (state.pageSize !== DEFAULT_PAGE_SIZE) sp.set('pageSize', String(state.pageSize));
  if (state.sort !== DEFAULT_SORT) sp.set('sort', state.sort);
  if (state.dir !== DEFAULT_DIR) sp.set('dir', state.dir);
  return sp;
}

export function mapUrlStateToHref(pathname: string, state: MapUrlState): string {
  const qs = serializeMapUrlState(state).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Cantidad de filtros activos (para el badge del botón "Filtros"). */
export function countActiveFilters(state: Pick<MapUrlState, 'filters' | 'loc' | 'num'>): number {
  let n = Object.values(state.filters).filter((v) => v.length > 0).length;
  if (state.loc) n += 1;
  if (state.num) n += 1;
  return n;
}

export type MapUrlActions = {
  set: (patch: Partial<MapUrlState>) => void;
  /** Cambia la capa de trabajo: cierra el panel de registro, limpia búsqueda y filtros, vuelve a la página 1. */
  setWorkingLayer: (layerId: number) => void;
  toggleOverlay: (layerId: number) => void;
  setOverlays: (layerIds: number[]) => void;
  setView: (view: MapView) => void;
  openRecord: (recordId: number) => void;
  openRole: (roleId: string) => void;
  openPolygon: (polygonId: number) => void;
  closePanel: () => void;
  togglePolygonKind: (kind: PolygonKind) => void;
  setHeat: (heat: HeatMode | null, heatLayers?: number[]) => void;
  setQuery: (q: string) => void;
  setFilters: (filters: Record<string, string[]>, loc: LocationFilter | null, num: NumberFilter | null) => void;
  clearFilters: () => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: string, dir: SortDir) => void;
};

/** Cambio puro de capa de trabajo (sin router), compartido entre el hook y los tests. */
export function applyWorkingLayer(state: MapUrlState, layerId: number): MapUrlState {
  return {
    ...state,
    layer: layerId,
    overlays: state.overlays.filter((id) => id !== layerId),
    record: null,
    q: '',
    filters: {},
    loc: null,
    num: null,
    page: 1,
    sort: DEFAULT_SORT,
    dir: DEFAULT_DIR,
  };
}

export function applyToggleOverlay(state: MapUrlState, layerId: number): MapUrlState {
  if (layerId === state.layer) return state;
  if (state.overlays.includes(layerId)) {
    return {
      ...state,
      overlays: state.overlays.filter((id) => id !== layerId),
      heatLayers: state.heatLayers.filter((id) => id !== layerId),
    };
  }
  if (state.overlays.length >= MAX_OVERLAY_LAYERS) return state;
  return { ...state, overlays: [...state.overlays, layerId] };
}

/**
 * Estado de la vista en la URL con `router.replace` (sin scroll ni entradas de historial).
 * Los setters pueden encadenarse en el mismo tick: siempre parten del último estado escrito.
 */
export function useMapUrlState(): { state: MapUrlState } & MapUrlActions {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state = useMemo(() => parseMapUrlState(searchParams), [searchParams]);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const commit = useCallback(
    (next: MapUrlState) => {
      latest.current = next;
      router.replace(mapUrlStateToHref(pathname, next), { scroll: false });
    },
    [router, pathname],
  );

  const set = useCallback((patch: Partial<MapUrlState>) => commit({ ...latest.current, ...patch }), [commit]);

  const actions = useMemo<MapUrlActions>(
    () => ({
      set,
      setWorkingLayer: (layerId) => commit(applyWorkingLayer(latest.current, layerId)),
      toggleOverlay: (layerId) => commit(applyToggleOverlay(latest.current, layerId)),
      setOverlays: (layerIds) =>
        set({ overlays: layerIds.filter((id) => id !== latest.current.layer).slice(0, MAX_OVERLAY_LAYERS) }),
      setView: (view) => set({ view }),
      openRecord: (recordId) => set({ record: recordId, role: null, polygon: null }),
      openRole: (roleId) => set({ role: roleId, record: null, polygon: null }),
      openPolygon: (polygonId) => set({ polygon: polygonId, record: null, role: null }),
      closePanel: () => set({ record: null, role: null, polygon: null }),
      togglePolygonKind: (kind) => {
        const polys = latest.current.polys;
        set({ polys: polys.includes(kind) ? polys.filter((k) => k !== kind) : [...polys, kind] });
      },
      setHeat: (heat, heatLayers) => set({ heat, heatLayers: heat ? (heatLayers ?? latest.current.heatLayers) : [] }),
      setQuery: (q) => set({ q, page: 1 }),
      setFilters: (filters, loc, num) => set({ filters, loc, num, page: 1 }),
      clearFilters: () => set({ filters: {}, loc: null, num: null, page: 1 }),
      setPage: (page) => set({ page: Math.max(1, page) }),
      setPageSize: (pageSize) => set({ pageSize, page: 1 }),
      setSort: (sort, dir) => set({ sort, dir, page: 1 }),
    }),
    [set, commit],
  );

  return { state, ...actions };
}
