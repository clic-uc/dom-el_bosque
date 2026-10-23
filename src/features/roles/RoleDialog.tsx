'use client';

import { GitBranch, MapPin, MapPinOff, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EntityDialog } from '@/components/shared/entity-dialog';
import { LayerIcon } from '@/components/shared/layer-icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCan } from '@/features/auth/actor-context';
import { HelpLink } from '@/features/help/HelpLink';
import { useDeleteRoleOperation, useRoleRecords } from '@/features/map/hooks';
import { PanelSection } from '@/features/map/SidePanel';
import { errorMessage } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/format';
import { departmentLabels, roleOperationTypeLabels } from '@/shared/constants';
import type { RoleOperationDto, RoleRecordItem } from '@/shared/types';
import { RoleStatusBadge } from './RoleInput';
import { RoleOperationDialog } from './RoleOperationDialog';

type Props = {
  roleId: string;
  workingLayerId: number | null;
  onClose: () => void;
  onOpenRole: (roleId: string) => void;
  /** Abrir un registro de la ficha: el contenedor superpone la capa si hace falta, hace flyTo y abre su ficha. */
  onOpenRecord: (record: RoleRecordItem, layerId: number) => void;
  /** Cierra la ficha y centra el mapa en el rol. */
  onViewOnMap: (lat: number, lon: number) => void;
  /** Ficha desde la que se llegó (por ejemplo, la de un registro). */
  back?: { label: string; onBack: () => void } | null;
};

function verb(type: RoleOperationDto['type']): string {
  return type === 'subdivision'
    ? 'Subdividido'
    : type === 'fusion'
      ? 'Fusionado'
      : type === 'rectificacion'
        ? 'Rectificado'
        : 'Modificado';
}

/** Columnas de la tabla de una capa: los campos del resumen en el orden en que aparecen. */
function summaryColumns(records: RoleRecordItem[]): string[] {
  const labels: string[] = [];
  for (const r of records) for (const s of r.summary) if (!labels.includes(s.label)) labels.push(s.label);
  return labels;
}

function RoleLink({ roleId, onOpenRole }: { roleId: string; onOpenRole: (roleId: string) => void }) {
  return (
    <button
      type="button"
      className="font-mono text-primary underline underline-offset-2"
      onClick={() => onOpenRole(roleId)}
    >
      {roleId}
    </button>
  );
}

/** Ficha del rol (§10.2): vigencia, historial de operaciones y registros agrupados por departamento → capa. */
export function RoleDialog({
  roleId,
  workingLayerId,
  onClose,
  onOpenRole,
  onOpenRecord,
  onViewOnMap,
  back,
}: Props) {
  const can = useCan();
  const id = useId();
  const [includeLineage, setIncludeLineage] = useState(false);
  const [opOpen, setOpOpen] = useState(false);
  const [deleteOp, setDeleteOp] = useState<RoleOperationDto | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const query = useRoleRecords(roleId, includeLineage);
  const removeOp = useDeleteRoleOperation();

  const title = (
    <>
      Rol <span className="font-mono">{roleId}</span>
    </>
  );

  if (query.isPending) {
    return (
      <EntityDialog title={title} size="lg" back={back} onRequestClose={onClose} data-testid="role-dialog">
        <LoadingState rows={6} label="Cargando la ficha del rol…" />
      </EntityDialog>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EntityDialog title={title} size="lg" back={back} onRequestClose={onClose} data-testid="role-dialog">
        <ErrorState
          title="No se pudo cargar el rol"
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      </EntityDialog>
    );
  }

  const { role, history, total, layerCount, groups } = query.data;
  const hasCoords = role.lat !== null && role.lon !== null;
  const superseding = history.operations.filter(
    (op) => op.originRoleIds.includes(role.id) && op.type !== 'modificacion',
  );
  const lastSuperseding = superseding[0] ?? null;
  const origin = history.operations.find((op) => op.resultRoleIds.includes(role.id));

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      {can('roles.write') ? (
        <Button variant="outline" size="lg" className="h-11" onClick={() => setOpOpen(true)}>
          <Plus aria-hidden /> Registrar operación
        </Button>
      ) : null}
      <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="outline" size="lg" className="h-11" onClick={onClose}>
          Cerrar
        </Button>
        {hasCoords ? (
          <Button size="lg" className="h-11" onClick={() => onViewOnMap(role.lat!, role.lon!)}>
            <MapPin aria-hidden /> Ver en el mapa
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <EntityDialog
      data-testid="role-dialog"
      size="lg"
      title={title}
      back={back}
      onRequestClose={onClose}
      footer={footer}
      eyebrow={
        <p className="flex flex-wrap items-center gap-2 text-base text-muted-foreground">
          Ficha del rol
          <HelpLink slug="mapa/ficha-del-rol" label="¿Qué muestra la ficha del rol?" />
          {role.vigente ? (
            <Badge className="rounded-md bg-secondary-soft text-sm text-secondary-strong" variant="outline">
              Vigente
            </Badge>
          ) : (
            <RoleStatusBadge status="superseded" className="text-sm" />
          )}
        </p>
      }
      subtitle={
        <div className="space-y-0.5">
          <p className="text-lg">{role.address ?? 'Sin dirección en el padrón'}</p>
          <p className="text-base text-muted-foreground">
            {total} {total === 1 ? 'registro' : 'registros'} en {layerCount}{' '}
            {layerCount === 1 ? 'capa' : 'capas'}
            {hasCoords ? '' : '. El padrón no tiene coordenadas para este rol'}
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        {!role.vigente && lastSuperseding ? (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTitle className="text-base text-amber-900">
              {verb(lastSuperseding.type)} el {formatDate(lastSuperseding.effectiveDate)}
              {lastSuperseding.resultRoleIds.length ? ' en ' : ''}
              {lastSuperseding.resultRoleIds.map((r, i) => (
                <span key={r}>
                  {i > 0 ? ', ' : ''}
                  <RoleLink roleId={r} onOpenRole={onOpenRole} />
                </span>
              ))}
              {lastSuperseding.reference ? ` (${lastSuperseding.reference})` : ''}.
            </AlertTitle>
            <AlertDescription className="text-base text-amber-900">
              Los permisos nuevos deben usar los roles resultantes. Los registros existentes conservan este
              rol.
            </AlertDescription>
          </Alert>
        ) : null}

        <PanelSection
          title={
            <>
              <GitBranch className="size-5" aria-hidden /> Historial del rol
            </>
          }
        >
          {origin ? (
            <p className="text-base">
              Proviene de la {roleOperationTypeLabels[origin.type].toLowerCase()} de{' '}
              {origin.originRoleIds.map((r, i) => (
                <span key={r}>
                  {i > 0 ? ', ' : ''}
                  <RoleLink roleId={r} onOpenRole={onOpenRole} />
                </span>
              ))}
              {origin.effectiveDate ? ` (${formatDate(origin.effectiveDate)})` : ''}.
            </p>
          ) : null}
          {history.operations.length === 0 ? (
            <p className="text-base text-muted-foreground">
              Sin operaciones registradas. El rol se mantiene tal como está en el padrón.
            </p>
          ) : (
            <ol className="relative ml-2 space-y-5 border-l pl-4">
              {history.operations.map((op) => (
                <li key={op.id} className="relative">
                  <span
                    className="absolute top-2 -left-[21px] size-2.5 rounded-full bg-primary"
                    aria-hidden
                  />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-base font-medium">{roleOperationTypeLabels[op.type]}</p>
                      <p className="text-sm text-muted-foreground">{formatDate(op.effectiveDate)}</p>
                      {op.reference ? <p className="text-sm text-muted-foreground">{op.reference}</p> : null}
                      <p className="text-base">
                        De{' '}
                        {op.originRoleIds.map((r, i) => (
                          <span key={r}>
                            {i > 0 ? ', ' : ''}
                            {r === role.id ? (
                              <span className="font-mono">{r}</span>
                            ) : (
                              <RoleLink roleId={r} onOpenRole={onOpenRole} />
                            )}
                          </span>
                        ))}
                        {op.resultRoleIds.length ? ' a ' : ''}
                        {op.resultRoleIds.map((r, i) => (
                          <span key={r}>
                            {i > 0 ? ', ' : ''}
                            {r === role.id ? (
                              <span className="font-mono">{r}</span>
                            ) : (
                              <RoleLink roleId={r} onOpenRole={onOpenRole} />
                            )}
                          </span>
                        ))}
                      </p>
                      {op.record ? (
                        <p className="text-sm text-muted-foreground">
                          Respaldada por el registro #{op.record.id} ({op.record.layerName})
                        </p>
                      ) : null}
                      {op.comment ? <p className="text-base">{op.comment}</p> : null}
                    </div>
                    {can('roleOperations.delete') ? (
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="size-11 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Eliminar operación ${roleOperationTypeLabels[op.type]} del ${formatDate(op.effectiveDate)}`}
                        onClick={() => {
                          setDeleteReason('');
                          setDeleteOp(op);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </PanelSection>

        <PanelSection title={`Registros (${total})`}>
          {history.ancestors.length ? (
            <div className="flex items-center gap-3">
              <Checkbox
                id={`${id}-lineage`}
                className="size-5"
                checked={includeLineage}
                onCheckedChange={(c) => setIncludeLineage(c === true)}
              />
              <Label htmlFor={`${id}-lineage`} className="text-base font-normal">
                Incluir registros de roles anteriores ({history.ancestors.join(', ')})
              </Label>
            </div>
          ) : null}
          {groups.length === 0 ? (
            <EmptyState
              title="Este rol no tiene registros"
              description="Puedes crear uno con el botón “Crear registro” de la barra superior."
              className="py-6"
            />
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <div key={g.department} className="space-y-3">
                  <h4 className="text-base font-semibold text-muted-foreground">
                    {departmentLabels[g.department]}
                  </h4>
                  {g.layers.map((l) => {
                    const columns = summaryColumns(l.records);
                    return (
                      <div key={l.layerId} className="overflow-hidden rounded-md border">
                        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                          <LayerIcon name={l.icon} color={l.iconColor} className="size-5" />
                          <span className="text-base font-medium">{l.layerName}</span>
                          <span className="text-base text-muted-foreground">
                            ({l.records.length} {l.records.length === 1 ? 'registro' : 'registros'})
                          </span>
                          {l.layerId === workingLayerId ? (
                            <Badge variant="outline" className="ml-auto rounded-md text-sm">
                              Capa de trabajo
                            </Badge>
                          ) : null}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-base">
                            <thead>
                              <tr className="border-b text-left text-sm text-muted-foreground">
                                {columns.length === 0 ? (
                                  <th scope="col" className="px-3 py-2 font-medium">
                                    Registro
                                  </th>
                                ) : null}
                                {columns.map((c) => (
                                  <th key={c} scope="col" className="px-3 py-2 font-medium">
                                    {c}
                                  </th>
                                ))}
                                <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                                  Actualizado
                                </th>
                                <th scope="col" className="px-3 py-2">
                                  <span className="sr-only">Acciones</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {l.records.map((r) => (
                                <tr
                                  key={r.id}
                                  className="cursor-pointer align-top hover:bg-muted/50"
                                  onClick={() => onOpenRecord(r, l.layerId)}
                                >
                                  {columns.length === 0 ? (
                                    <td className="px-3 py-2.5">Registro #{r.id}</td>
                                  ) : null}
                                  {columns.map((c, i) => (
                                    <td key={c} className="px-3 py-2.5">
                                      {i === 0 && r.roleId && r.roleId !== role.id ? (
                                        <span className="block text-sm text-muted-foreground">
                                          Rol <span className="font-mono">{r.roleId}</span>
                                        </span>
                                      ) : null}
                                      {r.summary.find((s) => s.label === c)?.value ?? (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </td>
                                  ))}
                                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                    {formatRelative(r.updatedAt)}
                                    {!r.hasCoordinates ? (
                                      <span className="mt-0.5 flex items-center gap-1 text-sm">
                                        <MapPinOff className="size-4" aria-hidden /> Sin ubicación
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    <Button
                                      variant="outline"
                                      className="h-11"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenRecord(r, l.layerId);
                                      }}
                                      aria-label={`Abrir la ficha del registro #${r.id}`}
                                    >
                                      Abrir ficha
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      </div>

      <RoleOperationDialog
        open={opOpen}
        onOpenChange={setOpOpen}
        originRoleId={role.id}
        workingLayerId={workingLayerId}
      />

      <ConfirmDialog
        open={deleteOp !== null}
        onOpenChange={(o) => !o && setDeleteOp(null)}
        title="Eliminar esta operación"
        destructive
        confirmLabel="Eliminar operación"
        pending={removeOp.isPending}
        disabled={deleteReason.trim().length < 3}
        onConfirm={async () => {
          if (!deleteOp) return;
          await removeOp.mutateAsync({ id: deleteOp.id, reason: deleteReason.trim() });
          setDeleteOp(null);
        }}
        description={
          deleteOp ? (
            <p>
              Se eliminará la {roleOperationTypeLabels[deleteOp.type].toLowerCase()} del{' '}
              {formatDate(deleteOp.effectiveDate)}. Los roles de origen ({deleteOp.originRoleIds.join(', ')})
              volverán a estar vigentes. Los registros no se modifican.
            </p>
          ) : null
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-del-reason`} className="text-base">
            Motivo (obligatorio)
          </Label>
          <Input
            id={`${id}-del-reason`}
            className="h-11 text-base"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="Por ejemplo: operación ingresada por error"
          />
        </div>
      </ConfirmDialog>
    </EntityDialog>
  );
}
