'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, FilterX, Play, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HelpLink } from '@/features/help/HelpLink';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDateTime, formatInt } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { importStatusLabels, importStatuses, type ImportStatus } from '@/shared/constants';
import type { ImportItem, ImportRevertResult, Paginated } from '@/shared/types';
import { useLayerOptions } from './AuditAdmin';
import { Paginator } from './Paginator';

const PAGE_SIZE = 20;
const ALL = 'all';

const statusStyles: Record<ImportStatus, string> = {
  UPLOADED: 'bg-slate-100 text-slate-800 border-slate-200',
  ANALYZING: 'bg-amber-100 text-amber-900 border-amber-200',
  REVIEW: 'bg-blue-100 text-blue-900 border-blue-200',
  COMMITTING: 'bg-amber-100 text-amber-900 border-amber-200',
  COMPLETED: 'bg-green-100 text-green-900 border-green-200',
  FAILED: 'bg-red-100 text-red-900 border-red-200',
  DISCARDED: 'bg-slate-100 text-slate-600 border-slate-200',
  REVERTED: 'bg-orange-100 text-orange-900 border-orange-200',
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  return (
    <Badge variant="outline" className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', statusStyles[status])}>
      {importStatusLabels[status]}
    </Badge>
  );
}

type Filters = { layerId: string; status: ImportStatus | typeof ALL };
const emptyFilters: Filters = { layerId: ALL, status: ALL };

type RevertState = { item: ImportItem; force: boolean; conflictMessage?: string } | null;

/** Historial de importaciones (§10.3): archivo, estado, capa, conteos, fecha, usuario y acciones. Consume `GET /api/imports`. */
export function ImportList() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [revert, setRevert] = useState<RevertState>(null);
  const layers = useLayerOptions();

  const params = {
    page,
    pageSize: PAGE_SIZE,
    layerId: filters.layerId === ALL ? undefined : Number(filters.layerId),
    status: filters.status === ALL ? undefined : filters.status,
  };

  const imports = useQuery({
    queryKey: queryKeys.imports.list(params),
    queryFn: () => api<Paginated<ImportItem>>('/api/imports', { query: params }),
    placeholderData: keepPreviousData,
  });

  const revertMutation = useMutation({
    mutationFn: ({ item, force }: { item: ImportItem; force: boolean }) =>
      api<ImportRevertResult>(`/api/imports/${item.id}/revert`, { method: 'POST', json: { force } }),
    onSuccess: (result, { item }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.layers.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
      setRevert(null);
      toast.success(
        `Importación de ${item.fileName} revertida: ${formatInt(result.deletedRecords)} registros eliminados y ${formatInt(result.restoredRecords + (result.reinsertedRecords ?? 0))} restaurados.`,
      );
    },
    onError: (err, { item, force }) => {
      // Cambios posteriores a la importación: segunda confirmación con `force`
      if (!force && err instanceof ApiError && err.code === 'CONFLICT') {
        setRevert({ item, force: true, conflictMessage: err.message });
        return;
      }
      toast.error(errorMessage(err, 'No se pudo revertir la importación. Intenta de nuevo.'));
    },
  });

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const hasFilters = filters.layerId !== ALL || filters.status !== ALL;
  const layerName = (id: number, fallback?: string) => fallback ?? layers.data?.find((l) => l.id === id)?.name ?? `Capa #${id}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <div className="min-w-56 space-y-1.5">
          <Label htmlFor="i-layer" className="text-sm">
            Capa
          </Label>
          <Select value={filters.layerId} onValueChange={(v) => update('layerId', v)}>
            <SelectTrigger id="i-layer" className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las capas</SelectItem>
              {(layers.data ?? []).map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-56 space-y-1.5">
          <Label htmlFor="i-status" className="text-sm">
            Estado
          </Label>
          <Select value={filters.status} onValueChange={(v) => update('status', v as Filters['status'])}>
            <SelectTrigger id="i-status" className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              {importStatuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {importStatusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasFilters ? (
          <Button type="button" variant="ghost" className="h-11 text-base" onClick={() => { setFilters(emptyFilters); setPage(1); }}>
            <FilterX aria-hidden /> Limpiar filtros
          </Button>
        ) : null}
        <div className="ml-auto">
          <HelpLink slug="importacion/revertir" withText label="¿Cómo funciona revertir?" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        {imports.isPending ? (
          <LoadingState rows={6} label="Cargando importaciones…" />
        ) : imports.isError ? (
          <ErrorState title="No se pudo cargar el historial de importaciones" message={errorMessage(imports.error)} onRetry={() => void imports.refetch()} />
        ) : imports.data.data.length === 0 ? (
          <EmptyState
            icon={FileUp}
            title={hasFilters ? 'No hay importaciones con estos filtros' : 'Todavía no se ha importado ningún archivo'}
            description={hasFilters ? 'Prueba quitando algún filtro.' : 'Las importaciones se hacen desde el mapa con el botón "Importar".'}
          />
        ) : (
          <div className={imports.isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table className="text-base">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="h-12 text-sm">Archivo</TableHead>
                  <TableHead className="h-12 text-sm">Estado</TableHead>
                  <TableHead className="h-12 text-sm">Capa</TableHead>
                  <TableHead className="h-12 text-sm">Resultado</TableHead>
                  <TableHead className="h-12 text-sm">Fecha</TableHead>
                  <TableHead className="h-12 text-sm">Usuario</TableHead>
                  <TableHead className="h-12 text-sm">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.data.data.map((item) => {
                  const canContinue = item.status === 'REVIEW' || item.status === 'UPLOADED';
                  const canRevert = item.status === 'COMPLETED';
                  return (
                    <TableRow key={item.id} className="align-top">
                      <TableCell className="max-w-56 py-3 break-all">{item.fileName}</TableCell>
                      <TableCell className="py-3">
                        <ImportStatusBadge status={item.status} />
                        {item.status === 'FAILED' && item.errorMessage ? <p className="mt-1 text-sm text-destructive">{item.errorMessage}</p> : null}
                      </TableCell>
                      <TableCell className="py-3">{layerName(item.layerId, item.layerName)}</TableCell>
                      <TableCell className="py-3 text-sm whitespace-nowrap">
                        <p>Creados: {formatInt(item.createdCount)}</p>
                        <p>Actualizados: {formatInt(item.updatedCount)}</p>
                        <p>Omitidos: {formatInt(item.skippedCount)}</p>
                        <p className={item.failedCount > 0 ? 'font-medium text-destructive' : undefined}>Fallidos: {formatInt(item.failedCount)}</p>
                        {item.deletedCount > 0 ? <p>Eliminados: {formatInt(item.deletedCount)}</p> : null}
                      </TableCell>
                      <TableCell className="py-3 whitespace-nowrap">{formatDateTime(item.createdAt)}</TableCell>
                      <TableCell className="py-3 break-all">{item.userEmail ?? item.userId}</TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          {canContinue ? (
                            <Button asChild variant="outline" className="h-11 text-sm">
                              <Link href={`/map?layer=${item.layerId}&import=${item.id}`}>
                                <Play aria-hidden /> Continuar
                              </Link>
                            </Button>
                          ) : null}
                          {item.failedCount > 0 ? (
                            <Button asChild variant="outline" className="h-11 text-sm">
                              <a href={`/api/imports/${item.id}/errors`} download>
                                <Download aria-hidden /> Descargar errores ({formatInt(item.failedCount)})
                              </a>
                            </Button>
                          ) : null}
                          {canRevert ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-11 border-destructive/40 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setRevert({ item, force: false })}
                            >
                              <Undo2 aria-hidden /> Revertir importación
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {imports.data ? <Paginator page={page} pageSize={PAGE_SIZE} total={imports.data.total} onPageChange={setPage} noun="importaciones" disabled={imports.isFetching} /> : null}

      <ConfirmDialog
        open={revert !== null}
        onOpenChange={(o) => !o && !revertMutation.isPending && setRevert(null)}
        title={revert?.force ? 'Hubo cambios después de esta importación' : `¿Revertir la importación de ${revert?.item.fileName ?? ''}?`}
        description={
          revert?.force ? (
            <div className="space-y-2">
              <p>{revert.conflictMessage}</p>
              <p>Si continúas, esos cambios posteriores se perderán al restaurar los registros a como estaban antes de importar.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p>
                Se eliminarán los {formatInt(revert?.item.createdCount ?? 0)} registros que creó y se restaurarán los{' '}
                {formatInt(revert?.item.updatedCount ?? 0)} que modificó a como estaban antes.
              </p>
              <p>La capa quedará como estaba antes de esta importación. Esta acción no se puede deshacer.</p>
            </div>
          )
        }
        confirmLabel={revert?.force ? 'Revertir de todos modos' : 'Revertir importación'}
        destructive
        pending={revertMutation.isPending}
        onConfirm={() => {
          if (revert) revertMutation.mutate({ item: revert.item, force: revert.force });
        }}
      />
    </div>
  );
}
