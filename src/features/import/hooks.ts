'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { Paginated } from '@/shared/schemas/common';
import type {
  AnalyzeImportInput,
  ImportRemovalsPatch,
  ImportRowPatch,
  ImportRowsBulkInput,
  ImportSourcePatch,
} from '@/shared/schemas/imports';
import type { ImportRemovalDto, ImportRowDto, ImportSource, ImportStatusFull } from '@/shared/types';

/** Hooks de TanStack Query para el asistente de importación (§8.5 / §10.2). */

export const REVIEW_PAGE_SIZE = 25;

function isBusy(s: ImportStatusFull | undefined): boolean {
  return !!s && (s.status === 'ANALYZING' || s.status === 'COMMITTING' || s.pendingGeocode > 0);
}

export function useImportStatus(importId: string | null | undefined, opts: { withSource?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.imports.detail(importId ?? ''), opts.withSource ? 'source' : 'status'] as const,
    queryFn: () =>
      api<ImportStatusFull>(`/api/imports/${importId}`, {
        query: opts.withSource ? { source: '1' } : undefined,
      }),
    enabled: !!importId,
    // Polling cada 1 s mientras el worker trabaja o quedan direcciones en OpenStreetMap (§8.5).
    refetchInterval: (q) => (isBusy(q.state.data) ? 1000 : false),
    staleTime: 0,
  });
}

export type RowsParams = { status?: ImportRowDto['status']; code?: string; page: number; pageSize?: number };

export function useImportRows(importId: string, params: RowsParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.imports.rows(importId, params),
    queryFn: () =>
      api<Paginated<ImportRowDto>>(`/api/imports/${importId}/rows`, {
        query: {
          status: params.status,
          code: params.code,
          page: params.page,
          pageSize: params.pageSize ?? REVIEW_PAGE_SIZE,
        },
      }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useImportRemovals(importId: string, page: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.imports.removals(importId, { page }),
    queryFn: () =>
      api<Paginated<ImportRemovalDto>>(`/api/imports/${importId}/removals`, {
        query: { page, pageSize: REVIEW_PAGE_SIZE },
      }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

function invalidateImport(qc: QueryClient, importId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.imports.detail(importId) });
  void qc.invalidateQueries({ queryKey: queryKeys.imports.rowsAll(importId) });
  void qc.invalidateQueries({ queryKey: ['imports', 'removals', importId] });
  void qc.invalidateQueries({ queryKey: queryKeys.imports.list() });
}

export function useUploadImport() {
  return useMutation({
    mutationFn: async ({ layerId, file }: { layerId: number; file: File }) => {
      const body = new FormData();
      body.set('layerId', String(layerId));
      body.set('file', file);
      return api<ImportSource>('/api/imports', { method: 'POST', body });
    },
  });
}

export function usePatchSource(importId: string | null) {
  return useMutation({
    mutationFn: (patch: ImportSourcePatch) =>
      api<ImportSource>(`/api/imports/${importId}`, { method: 'PATCH', json: patch }),
  });
}

export function useAnalyzeImport(importId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnalyzeImportInput) =>
      api(`/api/imports/${importId}/analyze`, { method: 'POST', json: input }),
    onSuccess: () => importId && invalidateImport(qc, importId),
  });
}

export function usePatchRow(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rowNumber, patch }: { rowNumber: number; patch: ImportRowPatch }) =>
      api<ImportRowDto>(`/api/imports/${importId}/rows/${rowNumber}`, { method: 'PATCH', json: patch }),
    onSuccess: () => invalidateImport(qc, importId),
  });
}

export function useBulkRows(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportRowsBulkInput) =>
      api<{ updated: number }>(`/api/imports/${importId}/rows/bulk`, { method: 'POST', json: input }),
    onSuccess: () => invalidateImport(qc, importId),
  });
}

export function usePatchRemovals(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportRemovalsPatch) =>
      api<{ updated: number }>(`/api/imports/${importId}/removals`, { method: 'PATCH', json: input }),
    onSuccess: () => invalidateImport(qc, importId),
  });
}

export function useCommitImport(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { acceptPendingGeocode: boolean }) =>
      api(`/api/imports/${importId}/commit`, { method: 'POST', json: input }),
    onSuccess: () => invalidateImport(qc, importId),
  });
}

export function useDiscardImport(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/imports/${importId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateImport(qc, importId),
  });
}
