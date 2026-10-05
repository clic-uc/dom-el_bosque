'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, errorMessage, type QueryParams } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { CoordsSource, PolygonKind } from '@/shared/constants';
import type { CreateRecordInput, UpdateCoordinatesInput, UpdateRecordInput } from '@/shared/schemas/records';
import type { CreateRoleOperationInput } from '@/shared/schemas/roles';
import type {
  DuplicateConflictDetails,
  FilterOptions,
  GeocodeResult,
  LayerCounter,
  LayerWithCount,
  Paginated,
  PolygonDetail,
  PolygonFeatureCollection,
  RecordDetail,
  RecordFeatureCollection,
  RecordListItem,
  RoleDto,
  RoleOperationDto,
  RoleRecords,
} from '@/shared/types';
import type { LocationFilter, NumberFilter, SortDir } from './url-state';

// ---------- parámetros ----------

export type FeatureParams = {
  search?: string;
  filters?: Record<string, string[]>;
  weight?: boolean;
  hasCoordinates?: boolean;
  coordsSource?: CoordsSource;
  hasNumber?: boolean;
};

export type RecordsPageParams = FeatureParams & {
  page: number;
  pageSize: number;
  sort: string;
  dir: SortDir;
};

/** Traduce los filtros de ubicación y correlativo de la URL a los parámetros de la API (§10.2 FiltersPanel). */
export function locationToParams(loc: LocationFilter | null, num: NumberFilter | null): Pick<FeatureParams, 'hasCoordinates' | 'coordsSource' | 'hasNumber'> {
  const out: Pick<FeatureParams, 'hasCoordinates' | 'coordsSource' | 'hasNumber'> = {};
  if (loc === 'none') out.hasCoordinates = false;
  if (loc === 'approx') out.coordsSource = 'geocoded';
  if (num === 'with') out.hasNumber = true;
  if (num === 'without') out.hasNumber = false;
  return out;
}

function toQuery(params: FeatureParams | RecordsPageParams): QueryParams {
  const q: QueryParams = {};
  if (params.search) q.search = params.search;
  if (params.filters && Object.keys(params.filters).length) {
    const clean: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(params.filters)) if (v.length) clean[k] = v;
    if (Object.keys(clean).length) q.filters = clean;
  }
  if (params.weight) q.weight = true;
  if (params.hasCoordinates !== undefined) q.hasCoordinates = params.hasCoordinates;
  if (params.coordsSource) q.coordsSource = params.coordsSource;
  if (params.hasNumber !== undefined) q.hasNumber = params.hasNumber;
  if ('page' in params) {
    q.page = params.page;
    q.pageSize = params.pageSize;
    q.sort = params.sort;
    q.dir = params.dir;
  }
  return q;
}

export function isDuplicateConflict(err: unknown): err is ApiError & { details: DuplicateConflictDetails } {
  return (
    err instanceof ApiError &&
    err.code === 'CONFLICT' &&
    typeof err.details === 'object' &&
    err.details !== null &&
    (err.details as { kind?: string }).kind === 'duplicate'
  );
}

// ---------- consultas ----------

export function useLayersQuery(): UseQueryResult<LayerWithCount[]> {
  return useQuery({
    queryKey: queryKeys.layers.list(),
    queryFn: () => api<LayerWithCount[]>('/api/layers'),
    staleTime: 60_000,
  });
}

/** Opciones de la consulta de features, compartidas por `useLayerFeatures` y el mapa de calor (`useQueries`). */
export function featuresQueryOptions(layerId: number, params: FeatureParams) {
  const query = toQuery(params);
  return {
    queryKey: queryKeys.layers.features(layerId, query),
    queryFn: () => api<RecordFeatureCollection>(`/api/layers/${layerId}/features`, { query }),
    staleTime: 60_000,
  };
}

export function useLayerFeatures(layerId: number | null, params: FeatureParams, enabled = true): UseQueryResult<RecordFeatureCollection> {
  return useQuery({
    ...featuresQueryOptions(layerId ?? 0, params),
    enabled: enabled && layerId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useRecordsPage(layerId: number | null, params: RecordsPageParams, enabled = true): UseQueryResult<Paginated<RecordListItem>> {
  const query = toQuery(params);
  return useQuery({
    queryKey: queryKeys.layers.records(layerId ?? 0, query),
    queryFn: () => api<Paginated<RecordListItem>>(`/api/layers/${layerId}/records`, { query }),
    enabled: enabled && layerId !== null,
    placeholderData: keepPreviousData,
  });
}

/** Búsqueda rápida de registros de la capa de trabajo para la barra superior (§8.6). */
export function useRecordSearch(layerId: number | null, search: string, enabled = true): UseQueryResult<Paginated<RecordListItem>> {
  const query: QueryParams = { search, pageSize: 8, page: 1 };
  return useQuery({
    queryKey: queryKeys.layers.records(layerId ?? 0, query),
    queryFn: () => api<Paginated<RecordListItem>>(`/api/layers/${layerId}/records`, { query }),
    enabled: enabled && layerId !== null && search.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function useFilterOptions(layerId: number | null, enabled = true): UseQueryResult<FilterOptions> {
  return useQuery({
    queryKey: queryKeys.layers.filters(layerId ?? 0),
    queryFn: () => api<FilterOptions>(`/api/layers/${layerId}/filters`),
    enabled: enabled && layerId !== null,
    staleTime: 60_000,
  });
}

export function useLayerCounters(layerId: number | null, enabled = true): UseQueryResult<LayerCounter[]> {
  return useQuery({
    queryKey: queryKeys.layers.counters(layerId ?? 0),
    queryFn: () => api<LayerCounter[]>(`/api/layers/${layerId}/counters`),
    enabled: enabled && layerId !== null,
    staleTime: 10_000,
  });
}

export function useRecordDetail(id: number | null): UseQueryResult<RecordDetail> {
  return useQuery({
    queryKey: queryKeys.records.detail(id ?? 0),
    queryFn: () => api<RecordDetail>(`/api/records/${id}`),
    enabled: id !== null,
  });
}

export function useRoleSearch(q: string, limit = 8, enabled = true): UseQueryResult<RoleDto[]> {
  const term = q.trim();
  return useQuery({
    queryKey: queryKeys.roles.search(term, limit),
    queryFn: () => api<RoleDto[]>('/api/roles', { query: { q: term, limit } }),
    enabled: enabled && term.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** Ficha básica del rol; 404 = rol nuevo (no se reintenta). */
export function useRoleDetail(roleId: string | null, enabled = true): UseQueryResult<RoleDto> {
  return useQuery({
    queryKey: queryKeys.roles.detail(roleId ?? ''),
    queryFn: () => api<RoleDto>(`/api/roles/${encodeURIComponent(roleId!)}`),
    enabled: enabled && !!roleId,
    retry: false,
    staleTime: 30_000,
  });
}

export function useRoleRecords(roleId: string | null, includeLineage = false): UseQueryResult<RoleRecords> {
  return useQuery({
    queryKey: queryKeys.roles.records(roleId ?? '', includeLineage),
    queryFn: () =>
      api<RoleRecords>(`/api/roles/${encodeURIComponent(roleId!)}/records`, {
        query: includeLineage ? { includeLineage: true } : undefined,
      }),
    enabled: !!roleId,
  });
}

export function usePolygons(kind: PolygonKind, enabled = true): UseQueryResult<PolygonFeatureCollection> {
  return useQuery({
    queryKey: queryKeys.polygons.kind(kind),
    queryFn: () => api<PolygonFeatureCollection>('/api/polygons', { query: { kind } }),
    enabled,
    staleTime: Infinity,
  });
}

export function usePolygonDetail(id: number | null): UseQueryResult<PolygonDetail> {
  return useQuery({
    queryKey: queryKeys.polygons.detail(id ?? 0),
    queryFn: () => api<PolygonDetail>(`/api/polygons/${id}`),
    enabled: id !== null,
  });
}

/** Opciones de la consulta de geocodificación puntual (§8.7), para `queryClient.fetchQuery` desde un handler. */
export function geocodeQueryOptions(q: string) {
  const term = q.trim();
  return {
    queryKey: queryKeys.geocode.query(term),
    queryFn: () => api<GeocodeResult | null>('/api/geocode', { query: { q: term } }),
    staleTime: 5 * 60_000,
    retry: false,
  };
}

// ---------- mutaciones ----------

function useInvalidators() {
  const qc = useQueryClient();
  return {
    layerData: (layerId: number) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.layers.featuresAll(layerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.layers.recordsAll(layerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.layers.filters(layerId) }),
      ]),
    allLayerData: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['layers', 'features'] }),
        qc.invalidateQueries({ queryKey: ['layers', 'records'] }),
      ]),
    layersList: () => qc.invalidateQueries({ queryKey: queryKeys.layers.list() }),
    record: (id: number) => qc.invalidateQueries({ queryKey: queryKeys.records.detail(id) }),
    roles: () => qc.invalidateQueries({ queryKey: queryKeys.roles.all }),
    roleOperations: () => qc.invalidateQueries({ queryKey: queryKeys.roleOperations.all }),
    counters: (layerId: number) => qc.invalidateQueries({ queryKey: queryKeys.layers.counters(layerId) }),
    polygons: () => qc.invalidateQueries({ queryKey: queryKeys.polygons.all }),
  };
}

/** Muestra el mensaje del servidor, salvo en conflictos por duplicado que la UI resuelve en línea. */
function toastError(err: unknown) {
  if (isDuplicateConflict(err)) return;
  toast.error(errorMessage(err));
}

export function useCreateRecord() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: (input: CreateRecordInput) => api<RecordDetail>('/api/records', { method: 'POST', json: input }),
    onSuccess: async (record) => {
      toast.success('Registro creado');
      await Promise.all([inv.layerData(record.layerId), inv.layersList(), inv.roles()]);
    },
    onError: toastError,
  });
}

export function useUpdateRecord() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateRecordInput }) =>
      api<RecordDetail>(`/api/records/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: async (record) => {
      toast.success('Cambios guardados');
      await Promise.all([inv.record(record.id), inv.layerData(record.layerId), inv.roles()]);
    },
    onError: toastError,
  });
}

export function useDeleteRecord() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; layerId: number; reason?: string }) =>
      api<void>(`/api/records/${id}`, { method: 'DELETE', json: reason ? { reason } : {} }),
    onSuccess: async (_data, vars) => {
      toast.success('Registro eliminado');
      await Promise.all([inv.layerData(vars.layerId), inv.layersList(), inv.roles()]);
    },
    onError: toastError,
  });
}

export function useUpdateCoordinates() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; layerId: number; input: UpdateCoordinatesInput }) =>
      api<{ updated: number }>(`/api/records/${id}/coordinates`, { method: 'PATCH', json: input }),
    onSuccess: async (res, vars) => {
      toast.success(res.updated > 1 ? `Coordenadas actualizadas en ${res.updated} registros` : 'Coordenadas actualizadas');
      await Promise.all([inv.record(vars.id), res.updated > 1 ? inv.allLayerData() : inv.layerData(vars.layerId), inv.roles()]);
    },
    onError: toastError,
  });
}

export function useAssignNumber() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id }: { id: number; layerId: number }) => api<{ number: number }>(`/api/records/${id}/number`, { method: 'POST' }),
    onSuccess: async (res, vars) => {
      toast.success(`Número ${new Intl.NumberFormat('es-CL').format(res.number)} asignado`);
      await Promise.all([inv.record(vars.id), inv.layerData(vars.layerId), inv.counters(vars.layerId)]);
    },
    onError: toastError,
  });
}

export function useCorrectNumber() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, value, reason }: { id: number; layerId: number; value: number | null; reason: string }) =>
      api<{ number: number | null }>(`/api/records/${id}/number`, { method: 'PUT', json: { value, reason } }),
    onSuccess: async (_res, vars) => {
      toast.success('Número corregido');
      await Promise.all([inv.record(vars.id), inv.layerData(vars.layerId), inv.counters(vars.layerId)]);
    },
    onError: toastError,
  });
}

export function useCreateRoleOperation() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: (input: CreateRoleOperationInput) => api<RoleOperationDto>('/api/role-operations', { method: 'POST', json: input }),
    onSuccess: async () => {
      toast.success('Operación registrada');
      await Promise.all([inv.roles(), inv.roleOperations(), inv.allLayerData()]);
    },
    onError: toastError,
  });
}

export function useDeleteRoleOperation() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api<void>(`/api/role-operations/${id}`, { method: 'DELETE', json: { reason } }),
    onSuccess: async () => {
      toast.success('Operación eliminada. Los roles de origen vuelven a estar vigentes.');
      await Promise.all([inv.roles(), inv.roleOperations()]);
    },
    onError: toastError,
  });
}

export function useUpdatePolygon() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api<PolygonDetail>(`/api/polygons/${id}`, { method: 'PATCH', json: { name } }),
    onSuccess: async () => {
      toast.success('Nombre guardado');
      await inv.polygons();
    },
    onError: toastError,
  });
}

/** Invalida los datos de una capa tras una importación (callback `onCompleted` del ImportWizard). */
export function useInvalidateLayerData() {
  const inv = useInvalidators();
  return async (layerId: number) => {
    await Promise.all([inv.layerData(layerId), inv.layersList(), inv.roles()]);
  };
}
