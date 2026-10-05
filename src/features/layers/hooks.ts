'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { FieldType } from '@/shared/constants';
import type { CreateLayerInput, UpdateLayerInput } from '@/shared/schemas/layers';
import type { SetNextNumberInput } from '@/shared/schemas/records';
import type {
  DuplicatesPreview,
  ImportItem,
  ImportRevertResult,
  Layer,
  LayerCounter,
  LayerWithCount,
  Paginated,
  TypeConversionPreview,
} from '@/shared/types';

/** Hooks de datos de capas (§9). Todas las mutaciones invalidan `queryKeys.layers.all` y avisan con toasts. */

export function useLayersQuery() {
  return useQuery({
    queryKey: queryKeys.layers.list(),
    queryFn: () => api<LayerWithCount[]>('/api/layers'),
  });
}

export function useLayerQuery(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.layers.detail(id ?? 0),
    queryFn: () => api<LayerWithCount>(`/api/layers/${id}`),
    enabled: id !== undefined,
  });
}

export function useCreateLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLayerInput) => api<Layer>('/api/layers', { method: 'POST', json: input }),
    onSuccess: async (layer) => {
      await qc.invalidateQueries({ queryKey: queryKeys.layers.all });
      toast.success(`Capa «${layer.name}» creada`);
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo crear la capa. Revisa los datos e intenta de nuevo.')),
  });
}

export function useUpdateLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateLayerInput }) =>
      api<Layer>(`/api/layers/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: async (layer) => {
      await qc.invalidateQueries({ queryKey: queryKeys.layers.all });
      toast.success(`Cambios guardados en «${layer.name}»`);
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudieron guardar los cambios. Intenta de nuevo.')),
  });
}

export function useDeleteLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/layers/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.layers.all });
      await qc.invalidateQueries({ queryKey: queryKeys.records.all });
      toast.success('Capa eliminada');
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo eliminar la capa. Intenta de nuevo.')),
  });
}

/** Grupos de registros repetidos que habría con estos campos únicos (§8.4). Solo para capas guardadas. */
export function useDuplicatesPreview(layerId: number | undefined, keys: string[], enabled = true) {
  return useQuery({
    queryKey: queryKeys.layers.duplicates(layerId ?? 0, keys),
    queryFn: () =>
      api<DuplicatesPreview>(`/api/layers/${layerId}/duplicates`, { query: { keys: keys.join(',') } }),
    enabled: enabled && layerId !== undefined && keys.length > 0,
    staleTime: 30_000,
  });
}

/** Cuántos valores existentes se pueden convertir al nuevo tipo (§7.2). */
export function useConvertPreview(
  layerId: number | undefined,
  key: string | undefined,
  toType: FieldType | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['layers', 'convert-preview', layerId ?? 0, key ?? '', toType ?? ''] as const,
    queryFn: () =>
      api<TypeConversionPreview>(`/api/layers/${layerId}/fields/${key}/convert-preview`, {
        query: { toType },
      }),
    enabled: enabled && layerId !== undefined && !!key && !!toType,
    staleTime: 30_000,
  });
}

export function useCounters(layerId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.layers.counters(layerId ?? 0),
    queryFn: () => api<LayerCounter[]>(`/api/layers/${layerId}/counters`),
    enabled: enabled && layerId !== undefined,
  });
}

export function useSetNextNumber(layerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetNextNumberInput) =>
      api<{ next: number }>(`/api/layers/${layerId}/counters`, { method: 'PUT', json: input }),
    onSuccess: async ({ next }) => {
      await qc.invalidateQueries({ queryKey: queryKeys.layers.counters(layerId) });
      toast.success(`Listo: el próximo número será el ${next}`);
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo ajustar el próximo número.')),
  });
}

/** Historial de importaciones de una capa (`GET /api/imports?layerId=`). La API la construye la fase 7. */
export function useLayerImports(layerId: number | undefined, enabled = true) {
  const params = { layerId, pageSize: 10 };
  return useQuery({
    queryKey: queryKeys.imports.list(params),
    queryFn: () => api<Paginated<ImportItem>>('/api/imports', { query: params }),
    enabled: enabled && layerId !== undefined,
  });
}

export function useRevertImport(layerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) =>
      api<ImportRevertResult>(`/api/imports/${importId}/revert`, { method: 'POST', json: {} }),
    onSuccess: async (res) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.imports.all }),
        qc.invalidateQueries({ queryKey: queryKeys.layers.list() }),
        qc.invalidateQueries({ queryKey: queryKeys.layers.detail(layerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.layers.featuresAll(layerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.layers.recordsAll(layerId) }),
        qc.invalidateQueries({ queryKey: queryKeys.records.all }),
      ]);
      toast.success(
        `Importación revertida: se eliminaron ${res.deletedRecords} registros y se restauraron ${res.restoredRecords}`,
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'No se pudo revertir la importación.')),
  });
}
