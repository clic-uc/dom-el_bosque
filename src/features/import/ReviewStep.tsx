'use client';

import { Globe, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HelpLink } from '@/features/help/HelpLink';
import { errorMessage } from '@/lib/api';
import type { ImportMessageCode } from '@/shared/schemas/import-rows';
import type { ImportRowPatch, ImportRowStatus } from '@/shared/schemas/imports';
import type { ImportStatusFull } from '@/shared/types';
import {
  REVIEW_PAGE_SIZE,
  useBulkRows,
  useCommitImport,
  useDiscardImport,
  useImportRemovals,
  useImportRows,
  usePatchRemovals,
  usePatchRow,
} from './hooks';
import { codeLabels, phaseLabels, plural, rowStatusHelp, rowStatusLabels } from './labels';
import { RemovalsTable, RowsTable } from './review-parts';

type Tab = ImportRowStatus | 'removals';
const TABS: ImportRowStatus[] = ['error', 'duplicate', 'warning', 'valid', 'excluded'];
const WARNING_CODES: ImportMessageCode[] = [
  'location_approx',
  'location_missing',
  'location_pending',
  'coords_outside_comuna',
  'role_assigned_by_address',
  'role_suggested_by_address',
  'unique_keys_incomplete',
  'role_new',
  'role_superseded',
];

function summaryOf(s: ImportStatusFull) {
  const created = s.counts.valid + s.counts.warning + s.resolutions.create;
  const updated = s.resolutions.update;
  const skipped = s.counts.excluded + s.resolutions.skip;
  const failed = s.counts.error;
  const deleted = s.removals?.toDelete ?? 0;
  return { created, updated, skipped, failed, deleted };
}

export function summaryText(s: ImportStatusFull): string {
  const x = summaryOf(s);
  const parts = [
    `Se crearán ${plural(x.created, 'registro', 'registros')}`,
    `se actualizarán ${x.updated.toLocaleString('es-CL')}`,
    `se omitirán ${x.skipped.toLocaleString('es-CL')}`,
    `fallarán ${x.failed.toLocaleString('es-CL')}`,
  ];
  if (s.fullReplace) parts.push(`se eliminarán ${x.deleted.toLocaleString('es-CL')}`);
  return parts.join(', ') + '.';
}

type Props = {
  status: ImportStatusFull;
  onDiscarded: () => void;
};

/** Paso 3 — Revisión (§10.2): pestañas por estado, tabla paginada con acciones, acciones en bloque y confirmación. */
export function ReviewStep({ status, onDiscarded }: Props) {
  const importId = status.id;
  // Pestaña inicial: la primera con contenido (derivada del estado; el usuario la cambia después).
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const tab: Tab = chosenTab ?? TABS.find((t) => status.counts[t] > 0) ?? 'valid';
  const [code, setCode] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [excludeAllOpen, setExcludeAllOpen] = useState(false);

  const inReview = status.status === 'REVIEW';
  const busy = status.status === 'ANALYZING' || status.status === 'COMMITTING';

  const rowsQuery = useImportRows(
    importId,
    {
      status: tab === 'removals' ? undefined : tab,
      code: tab === 'warning' && code !== 'all' ? code : undefined,
      page,
    },
    inReview && tab !== 'removals',
  );
  const removalsQuery = useImportRemovals(importId, page, inReview && tab === 'removals');
  const patchRow = usePatchRow(importId);
  const bulk = useBulkRows(importId);
  const patchRemovals = usePatchRemovals(importId);
  const commit = useCommitImport(importId);
  const discard = useDiscardImport(importId);

  const onPatch = (rowNumber: number, patch: ImportRowPatch) =>
    patchRow.mutateAsync({ rowNumber, patch }).catch((err) => {
      toast.error(errorMessage(err));
      throw err;
    });

  const runBulk = (input: Parameters<typeof bulk.mutate>[0], done: (n: number) => string) =>
    bulk.mutate(input, {
      onSuccess: (r) => toast.success(done(r.updated)),
      onError: (err) => toast.error(errorMessage(err)),
    });

  function changeTab(t: string) {
    setTab(t as Tab);
    setPage(1);
    setCode('all');
  }

  if (busy || status.status === 'UPLOADED') {
    const p = status.progress ?? {};
    const pct = p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 0;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
        <p className="text-lg font-medium" aria-live="polite">
          {status.status === 'COMMITTING' ? 'Guardando los registros…' : 'Analizando el archivo…'}
        </p>
        <p className="text-base text-muted-foreground">
          {phaseLabels[p.phase ?? ''] ?? ''}
          {p.total
            ? ` · ${(p.done ?? 0).toLocaleString('es-CL')} de ${p.total.toLocaleString('es-CL')} filas`
            : ''}
        </p>
        <Progress value={pct} className="h-3 w-full max-w-md" aria-label="Progreso" />
        <p className="text-sm text-muted-foreground">
          Puedes cerrar esta ventana: el trabajo sigue y podrás retomarlo desde el historial de la capa.
        </p>
      </div>
    );
  }

  if (status.status === 'FAILED') {
    return (
      <div className="flex h-full flex-col">
        <ErrorState title="El análisis no se pudo completar" message={status.errorMessage ?? undefined} />
        <div className="mt-auto flex justify-end border-t pt-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 text-base"
            onClick={() => setDiscardOpen(true)}
          >
            Descartar
          </Button>
        </div>
        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="¿Descartar esta importación?"
          description="Se borrará el borrador y el archivo subido. No se modifica ningún registro de la capa."
          confirmLabel="Descartar"
          destructive
          pending={discard.isPending}
          onConfirm={() =>
            discard.mutate(undefined, {
              onSuccess: onDiscarded,
              onError: (err) => toast.error(errorMessage(err)),
            })
          }
        />
      </div>
    );
  }

  const total = tab === 'removals' ? (removalsQuery.data?.total ?? 0) : (rowsQuery.data?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  const summary = summaryOf(status);
  const unresolved = status.counts.unresolvedDuplicates;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Revisa las filas antes de guardar</h3>
          <p className="text-base text-muted-foreground">
            Nada se guarda en la capa hasta que confirmes al final.
          </p>
        </div>
        <HelpLink slug="importacion/asistente" label="Cómo revisar la importación" withText />
      </div>

      {status.pendingGeocode > 0 ? (
        <p
          className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-base text-sky-900"
          aria-live="polite"
        >
          <Globe className="size-5 animate-pulse" aria-hidden />
          Buscando {plural(status.pendingGeocode, 'dirección', 'direcciones')} en OpenStreetMap… Puedes seguir
          revisando mientras tanto.
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="h-10 text-base">
              {rowStatusLabels[t]}{' '}
              <span className="ml-1 rounded-full bg-muted-foreground/15 px-2 text-sm tabular-nums">
                {status.counts[t].toLocaleString('es-CL')}
              </span>
            </TabsTrigger>
          ))}
          {status.fullReplace ? (
            <TabsTrigger value="removals" className="h-10 text-base">
              No están en el archivo{' '}
              <span className="ml-1 rounded-full bg-muted-foreground/15 px-2 text-sm tabular-nums">
                {(status.removals?.total ?? 0).toLocaleString('es-CL')}
              </span>
            </TabsTrigger>
          ) : null}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {tab === 'removals'
            ? 'Registros de la capa que no vienen en el archivo. Por defecto se conservan; los creados en la plataforma aparecen destacados.'
            : rowStatusHelp[tab]}
        </p>
        {tab === 'warning' ? (
          <div className="flex items-center gap-2">
            <Label htmlFor="warning-code" className="text-sm">
              Tipo
            </Label>
            <Select value={code} onValueChange={(v) => (setCode(v), setPage(1))}>
              <SelectTrigger id="warning-code" className="h-10 w-64 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-base">
                  Todas las advertencias
                </SelectItem>
                {WARNING_CODES.filter((c) => (status.codeCounts[c] ?? 0) > 0).map((c) => (
                  <SelectItem key={c} value={c} className="text-base">
                    {codeLabels[c]} ({status.codeCounts[c]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {tab === 'error' && status.counts.error > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={bulk.isPending}
            onClick={() => setExcludeAllOpen(true)}
          >
            Excluir todas las filas con errores
          </Button>
        ) : null}
        {tab === 'duplicate' && status.counts.duplicate > 0 ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={bulk.isPending}
              onClick={() =>
                runBulk({ filter: { status: 'duplicate' }, action: 'skip' }, (n) => `${n} filas se omitirán`)
              }
            >
              Omitir todas
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={bulk.isPending}
              onClick={() =>
                runBulk(
                  { filter: { status: 'duplicate' }, action: 'update' },
                  (n) => `${n} registros existentes se actualizarán`,
                )
              }
            >
              Actualizar todos los existentes
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={bulk.isPending}
              onClick={() =>
                runBulk(
                  { filter: { status: 'duplicate' }, action: 'create' },
                  (n) => `${n} filas se crearán como registros nuevos`,
                )
              }
            >
              Crear todas igual
            </Button>
          </>
        ) : null}
        {tab === 'warning' && (status.codeCounts.location_approx ?? 0) > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={bulk.isPending}
            onClick={() =>
              runBulk(
                { filter: { code: 'location_approx' }, action: 'accept_suggestion' },
                (n) => `${n} ubicaciones aceptadas`,
              )
            }
          >
            Aceptar todas las ubicaciones aproximadas
          </Button>
        ) : null}
        {tab === 'warning' && (status.codeCounts.role_suggested_by_address ?? 0) > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={bulk.isPending}
            onClick={() =>
              runBulk(
                { filter: { code: 'role_suggested_by_address' }, action: 'accept_suggestion' },
                (n) => `${n} roles aceptados`,
              )
            }
          >
            Aceptar todos los roles sugeridos
          </Button>
        ) : null}
        {tab === 'excluded' && status.counts.excluded > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={bulk.isPending}
            onClick={() =>
              runBulk(
                { filter: { status: 'excluded' }, action: 'include' },
                (n) => `${n} filas vuelven a incluirse`,
              )
            }
          >
            Volver a incluir todas
          </Button>
        ) : null}
        {tab === 'removals' && (status.removals?.total ?? 0) > 0 ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={patchRemovals.isPending}
              onClick={() =>
                patchRemovals.mutate(
                  { all: true, resolution: 'keep' },
                  { onError: (e) => toast.error(errorMessage(e)) },
                )
              }
            >
              Conservar todos
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 border-destructive/50 text-destructive"
              disabled={patchRemovals.isPending}
              onClick={() =>
                patchRemovals.mutate(
                  { all: true, resolution: 'delete' },
                  {
                    onSuccess: (r) => toast.success(`${r.updated} registros se eliminarán al confirmar`),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
            >
              Eliminar todos los que se puedan
            </Button>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {tab === 'removals' ? (
          removalsQuery.isPending ? (
            <LoadingState />
          ) : removalsQuery.error ? (
            <ErrorState
              message={errorMessage(removalsQuery.error)}
              onRetry={() => void removalsQuery.refetch()}
            />
          ) : removalsQuery.data!.data.length === 0 ? (
            <EmptyState title="Todos los registros de la capa vienen en el archivo" />
          ) : (
            <RemovalsTable
              rows={removalsQuery.data!.data}
              onMark={(recordId, resolution) =>
                patchRemovals
                  .mutateAsync({ recordIds: [recordId], resolution })
                  .catch((e) => toast.error(errorMessage(e)))
              }
            />
          )
        ) : rowsQuery.isPending ? (
          <LoadingState />
        ) : rowsQuery.error ? (
          <ErrorState message={errorMessage(rowsQuery.error)} onRetry={() => void rowsQuery.refetch()} />
        ) : rowsQuery.data!.data.length === 0 ? (
          <EmptyState
            title={`No hay filas en "${rowStatusLabels[tab]}"`}
            description="Revisa las otras pestañas o confirma la importación."
          />
        ) : (
          <RowsTable rows={rowsQuery.data!.data} tab={tab} status={status} onPatch={onPatch} />
        )}
      </div>

      {total > REVIEW_PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span>
            Página {page} de {pages} · {total.toLocaleString('es-CL')} filas
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <p className="mr-auto text-base">
          {summaryText(status)}
          {unresolved > 0 ? (
            <span className="ml-1 font-medium text-amber-800">
              Quedan {plural(unresolved, 'duplicado sin resolver', 'duplicados sin resolver')}.
            </span>
          ) : null}
        </p>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 text-base"
          onClick={() => setDiscardOpen(true)}
          disabled={commit.isPending}
        >
          Descartar
        </Button>
        <Button
          type="button"
          size="lg"
          className="h-11 text-base"
          disabled={unresolved > 0 || commit.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          Confirmar importación
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Confirmar la importación?"
        description={
          <div className="space-y-2">
            <p>{summaryText(status)}</p>
            {status.pendingGeocode > 0 ? (
              <p className="font-medium text-amber-800">
                Todavía se están buscando {plural(status.pendingGeocode, 'dirección', 'direcciones')} en
                OpenStreetMap. Si confirmas ahora, esas filas se importarán sin ubicación (podrás ubicarlas
                después desde el mapa).
              </p>
            ) : null}
            {summary.deleted > 0 ? (
              <p className="font-medium text-destructive">
                Se eliminarán {plural(summary.deleted, 'registro', 'registros')} de la capa.
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Podrás revertir esta importación desde el historial de la capa.
            </p>
          </div>
        }
        confirmLabel="Confirmar importación"
        pending={commit.isPending}
        onConfirm={() =>
          commit.mutate(
            { acceptPendingGeocode: status.pendingGeocode > 0 },
            { onSuccess: () => setConfirmOpen(false), onError: (err) => toast.error(errorMessage(err)) },
          )
        }
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="¿Descartar esta importación?"
        description="Se borrará el borrador con todas las correcciones hechas aquí y el archivo subido. No se modifica ningún registro de la capa."
        confirmLabel="Descartar"
        destructive
        pending={discard.isPending}
        onConfirm={() =>
          discard.mutate(undefined, {
            onSuccess: onDiscarded,
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
      <ConfirmDialog
        open={excludeAllOpen}
        onOpenChange={setExcludeAllOpen}
        title="¿Excluir todas las filas con errores?"
        description={`${plural(status.counts.error, 'fila', 'filas')} no se importarán. Podrás volver a incluirlas desde la pestaña Excluidas.`}
        confirmLabel="Excluir filas"
        pending={bulk.isPending}
        onConfirm={() =>
          bulk.mutate(
            { filter: { status: 'error' }, action: 'exclude' },
            {
              onSuccess: (r) => (setExcludeAllOpen(false), toast.success(`${r.updated} filas excluidas`)),
              onError: (err) => toast.error(errorMessage(err)),
            },
          )
        }
      />
    </div>
  );
}
