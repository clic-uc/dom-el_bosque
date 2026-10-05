'use client';

import { Crosshair, GitBranch, MapPinOff, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
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
import { PanelSection, SidePanel } from '@/features/map/SidePanel';
import { errorMessage } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/format';
import { departmentLabels, roleOperationTypeLabels } from '@/shared/constants';
import type { RoleOperationDto, RoleRecordItem } from '@/shared/types';
import { RoleOperationDialog } from './RoleOperationDialog';
import { RoleStatusBadge } from './RoleInput';

type Props = {
  roleId: string;
  workingLayerId: number | null;
  onClose: () => void;
  onOpenRole: (roleId: string) => void;
  /** Abrir un registro de la ficha: el contenedor superpone la capa si hace falta, hace flyTo y abre su panel. */
  onOpenRecord: (record: RoleRecordItem, layerId: number) => void;
  onViewOnMap: (lat: number, lon: number) => void;
};

function verb(type: RoleOperationDto['type']): string {
  return type === 'subdivision' ? 'Subdividido' : type === 'fusion' ? 'Fusionado' : type === 'rectificacion' ? 'Rectificado' : 'Modificado';
}

/** Ficha del rol (§10.2): vigencia, historial de operaciones y registros agrupados por departamento → capa. */
export function RoleSheet({ roleId, workingLayerId, onClose, onOpenRole, onOpenRecord, onViewOnMap }: Props) {
  const can = useCan();
  const id = useId();
  const [includeLineage, setIncludeLineage] = useState(false);
  const [opOpen, setOpOpen] = useState(false);
  const [deleteOp, setDeleteOp] = useState<RoleOperationDto | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const query = useRoleRecords(roleId, includeLineage);
  const removeOp = useDeleteRoleOperation();

  if (query.isPending) {
    return (
      <SidePanel title={`Rol ${roleId}`} onClose={onClose} width={400}>
        <LoadingState rows={6} label="Cargando la ficha del rol…" />
      </SidePanel>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SidePanel title={`Rol ${roleId}`} onClose={onClose} width={400}>
        <ErrorState title="No se pudo cargar el rol" message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </SidePanel>
    );
  }

  const { role, history, total, layerCount, groups } = query.data;
  const hasCoords = role.lat !== null && role.lon !== null;
  const superseding = history.operations.filter((op) => op.originRoleIds.includes(role.id) && op.type !== 'modificacion');
  const lastSuperseding = superseding[0] ?? null;
  const origin = history.operations.find((op) => op.resultRoleIds.includes(role.id));

  return (
    <SidePanel
      title={`Rol ${role.id}`}
      onClose={onClose}
      width={400}
      data-testid="role-sheet"
      subtitle={
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {role.vigente ? (
              <Badge className="rounded-md bg-secondary-soft text-secondary-strong" variant="outline">
                Vigente
              </Badge>
            ) : (
              <RoleStatusBadge status="superseded" />
            )}
            <Badge variant="outline" className="rounded-md">
              {total} {total === 1 ? 'registro' : 'registros'} en {layerCount} {layerCount === 1 ? 'capa' : 'capas'}
            </Badge>
            <HelpLink slug="mapa/ficha-del-rol" label="¿Qué muestra la ficha del rol?" />
          </div>
          {role.address ? <p className="text-base text-foreground">{role.address}</p> : <p>Sin dirección en el padrón</p>}
        </div>
      }
      headerExtra={
        <Button variant="outline" size="lg" className="h-11 shrink-0" disabled={!hasCoords} onClick={() => hasCoords && onViewOnMap(role.lat!, role.lon!)} title={hasCoords ? undefined : 'El rol no tiene coordenadas en el padrón'}>
          <Crosshair aria-hidden /> Ver en el mapa
        </Button>
      }
    >
      <div className="space-y-6">
        {!role.vigente && lastSuperseding ? (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTitle className="text-amber-900">
              {verb(lastSuperseding.type)} el {formatDate(lastSuperseding.effectiveDate)}
              {lastSuperseding.resultRoleIds.length ? ' en ' : ''}
              {lastSuperseding.resultRoleIds.map((r, i) => (
                <span key={r}>
                  {i > 0 ? ', ' : ''}
                  <button type="button" className="font-mono underline" onClick={() => onOpenRole(r)}>
                    {r}
                  </button>
                </span>
              ))}
              {lastSuperseding.reference ? ` (${lastSuperseding.reference})` : ''}.
            </AlertTitle>
            <AlertDescription className="text-amber-900">Los permisos nuevos deben usar los roles resultantes. Los registros existentes conservan este rol.</AlertDescription>
          </Alert>
        ) : null}
        {origin ? (
          <p className="text-sm text-muted-foreground">
            Proviene de la {roleOperationTypeLabels[origin.type].toLowerCase()} de{' '}
            {origin.originRoleIds.map((r, i) => (
              <span key={r}>
                {i > 0 ? ', ' : ''}
                <button type="button" className="font-mono text-primary underline" onClick={() => onOpenRole(r)}>
                  {r}
                </button>
              </span>
            ))}
            {origin.effectiveDate ? ` (${formatDate(origin.effectiveDate)})` : ''}.
          </p>
        ) : null}

        <PanelSection
          title={
            <>
              <GitBranch className="size-4" aria-hidden /> Historial del rol
            </>
          }
          action={
            can('roles.write') ? (
              <Button variant="outline" size="sm" className="h-9" onClick={() => setOpOpen(true)}>
                <Plus aria-hidden /> Registrar operación
              </Button>
            ) : null
          }
        >
          {history.operations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin operaciones registradas. El rol se mantiene tal como está en el padrón.</p>
          ) : (
            <ol className="relative ml-2 space-y-4 border-l pl-4">
              {history.operations.map((op) => (
                <li key={op.id} className="relative">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary" aria-hidden />
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-base font-medium">
                        {roleOperationTypeLabels[op.type]} · {formatDate(op.effectiveDate)}
                      </p>
                      {op.reference ? <p className="text-sm text-muted-foreground">{op.reference}</p> : null}
                      <p className="font-mono text-sm">
                        {op.originRoleIds.map((r, i) => (
                          <span key={r}>
                            {i > 0 ? ', ' : ''}
                            {r === role.id ? (
                              <span>{r}</span>
                            ) : (
                              <button type="button" className="text-primary underline" onClick={() => onOpenRole(r)}>
                                {r}
                              </button>
                            )}
                          </span>
                        ))}
                        {op.resultRoleIds.length ? ' → ' : ''}
                        {op.resultRoleIds.map((r, i) => (
                          <span key={r}>
                            {i > 0 ? ', ' : ''}
                            {r === role.id ? (
                              <span>{r}</span>
                            ) : (
                              <button type="button" className="text-primary underline" onClick={() => onOpenRole(r)}>
                                {r}
                              </button>
                            )}
                          </span>
                        ))}
                      </p>
                      {op.record ? (
                        <p className="text-sm text-muted-foreground">
                          Respaldada por el registro #{op.record.id} ({op.record.layerName})
                        </p>
                      ) : null}
                      {op.comment ? <p className="text-sm">{op.comment}</p> : null}
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
              <Checkbox id={`${id}-lineage`} className="size-5" checked={includeLineage} onCheckedChange={(c) => setIncludeLineage(c === true)} />
              <Label htmlFor={`${id}-lineage`} className="text-base font-normal">
                Incluir registros de roles anteriores ({history.ancestors.join(', ')})
              </Label>
            </div>
          ) : null}
          {groups.length === 0 ? (
            <EmptyState title="Este rol no tiene registros" description="Puedes crear uno con el botón “Crear registro” de la barra superior." className="py-6" />
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.department} className="space-y-2">
                  <h4 className="text-sm font-semibold">{departmentLabels[g.department]}</h4>
                  {g.layers.map((l) => (
                    <div key={l.layerId} className="rounded-md border">
                      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                        <LayerIcon name={l.icon} color={l.iconColor} className="size-4" />
                        <span className="flex-1 text-base font-medium">{l.layerName}</span>
                        {l.layerId === workingLayerId ? (
                          <Badge variant="outline" className="rounded-md">
                            Capa de trabajo
                          </Badge>
                        ) : null}
                        <span className="text-sm text-muted-foreground">{l.records.length}</span>
                      </div>
                      <ul className="divide-y">
                        {l.records.map((r) => (
                          <li key={r.id}>
                            <button type="button" className="flex min-h-11 w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted" onClick={() => onOpenRecord(r, l.layerId)}>
                              <span className="flex w-full items-center gap-2">
                                <span className="flex-1 truncate text-base">{r.summary.length ? r.summary.map((s) => `${s.label}: ${s.value}`).join(' · ') : `Registro #${r.id}`}</span>
                                {!r.hasCoordinates ? <MapPinOff className="size-4 shrink-0 text-muted-foreground" aria-label="Sin coordenadas" /> : null}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {r.roleId && r.roleId !== role.id ? `Rol ${r.roleId} · ` : ''}
                                Actualizado {formatRelative(r.updatedAt)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      </div>

      <RoleOperationDialog open={opOpen} onOpenChange={setOpOpen} originRoleId={role.id} workingLayerId={workingLayerId} />

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
              Se eliminará la {roleOperationTypeLabels[deleteOp.type].toLowerCase()} del {formatDate(deleteOp.effectiveDate)}. Los roles de origen ({deleteOp.originRoleIds.join(', ')}) volverán a estar vigentes. Los registros no se modifican.
            </p>
          ) : null
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-del-reason`} className="text-base">
            Motivo (obligatorio)
          </Label>
          <Input id={`${id}-del-reason`} className="h-11 text-base" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Por ejemplo: operación ingresada por error" />
        </div>
      </ConfirmDialog>
    </SidePanel>
  );
}
