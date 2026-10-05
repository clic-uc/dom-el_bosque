'use client';

import { Crosshair, ExternalLink, Hash, Loader2, LocateFixed, MapPinOff, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { LayerIcon } from '@/components/shared/layer-icon';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/shared/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentsList } from '@/features/attachments/AttachmentsList';
import { useCan } from '@/features/auth/actor-context';
import { HelpLink } from '@/features/help/HelpLink';
import { coerceFieldValue, FieldInput, toFieldValue, type FieldValue } from '@/features/records/FieldInput';
import { RoleInput } from '@/features/roles/RoleInput';
import { errorMessage } from '@/lib/api';
import { formatCoord, formatDate, formatDateTime, formatFieldValue, formatInt } from '@/lib/format';
import { coordsSourceLabels, geocodeConfidenceLabels, roleOperationTypeLabels } from '@/shared/constants';
import type { UpdateRecordInput } from '@/shared/schemas/records';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { LayerField, RecordDetail, RoleDto } from '@/shared/types';
import {
  isDuplicateConflict,
  useAssignNumber,
  useCorrectNumber,
  useDeleteRecord,
  useLayerCounters,
  useRecordDetail,
  useUpdateCoordinates,
  useUpdateRecord,
} from './hooks';
import { PanelSection, SidePanel } from './SidePanel';

type Props = {
  recordId: number;
  workingLayerId: number | null;
  onClose: () => void;
  onOpenRole: (roleId: string) => void;
  onOpenRecord: (recordId: number) => void;
  onWorkInLayer: (layerId: number) => void;
  onCenter: (lat: number, lon: number) => void;
};

type Draft = {
  roleId: string;
  lat: string;
  lon: string;
  attributes: Record<string, FieldValue>;
  comments: string;
};

function draftFrom(record: RecordDetail): Draft {
  const attributes: Record<string, FieldValue> = {};
  for (const f of record.layer.fields) attributes[f.key] = toFieldValue(f, record.attributes[f.key]);
  return {
    roleId: record.roleId ?? '',
    lat: record.lat === null ? '' : formatCoord(record.lat),
    lon: record.lon === null ? '' : formatCoord(record.lon),
    attributes,
    comments: record.comments ?? '',
  };
}

function parseCoord(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function sameValue(a: unknown, b: unknown): boolean {
  const na = a === undefined || a === '' ? null : a;
  const nb = b === undefined || b === '' ? null : b;
  return na === nb;
}

function operationSentence(type: string, date: string, results: string[], reference?: string | null): string {
  const verb =
    type === 'subdivision'
      ? 'subdividido'
      : type === 'fusion'
        ? 'fusionado'
        : type === 'rectificacion'
          ? 'rectificado'
          : 'modificado';
  const tail = results.length ? ` en ${results.join(', ')}` : '';
  const ref = reference ? ` (${reference})` : '';
  return `Este rol fue ${verb} el ${formatDate(date)}${tail}${ref}.`;
}

/** Panel derecho del registro (§10.2): lectura y edición completa, correlativo, comentarios y adjuntos. */
export function RecordSidePanel({
  recordId,
  workingLayerId,
  onClose,
  onOpenRole,
  onOpenRecord,
  onWorkInLayer,
  onCenter,
}: Props) {
  const can = useCan();
  const canEdit = can('records.write');
  const ids = useId();
  const detail = useRecordDetail(recordId);
  const record = detail.data;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftKey, setDraftKey] = useState<string>('');
  const [resolvedRole, setResolvedRole] = useState<RoleDto | null>(null);
  const [duplicate, setDuplicate] = useState<{ message: string; existingRecordId: number } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctValue, setCorrectValue] = useState('');
  const [correctReason, setCorrectReason] = useState('');

  // El borrador se rehace cuando cambia el registro o llega una versión nueva del servidor (tras guardar).
  // (Patrón "ajustar estado durante el render" de React: sin efecto ni render extra con datos viejos.)
  const serverKey = record ? `${record.id}:${record.updatedAt}` : '';
  if (record && serverKey !== draftKey) {
    setDraft(draftFrom(record));
    setDraftKey(serverKey);
    setDuplicate(null);
    setValidation(null);
  }

  const update = useUpdateRecord();
  const remove = useDeleteRecord();
  const coords = useUpdateCoordinates();
  const assign = useAssignNumber();
  const correct = useCorrectNumber();

  const autoField: LayerField | undefined = record?.layer.fields.find((f) => f.type === 'autonumber');
  const editableFields = useMemo(
    () => record?.layer.fields.filter((f) => f.type !== 'autonumber') ?? [],
    [record],
  );
  const counters = useLayerCounters(
    record?.layerId ?? null,
    assignOpen && can('records.assignNumber') && !!autoField,
  );
  const nextNumber = counters.data?.find((c) => c.fieldKey === autoField?.key)?.next ?? null;

  const patch = useMemo<UpdateRecordInput | null>(() => {
    if (!record || !draft) return null;
    const p: UpdateRecordInput = {};
    if (record.layer.hasRole) {
      const parsed = tryNormalizeRoleId(draft.roleId);
      const next = parsed.ok ? parsed.value : draft.roleId.trim() || null;
      if (next !== record.roleId) p.roleId = next;
    }
    const lat = parseCoord(draft.lat);
    const lon = parseCoord(draft.lon);
    if (!Number.isNaN(lat) && !Number.isNaN(lon) && (lat !== record.lat || lon !== record.lon)) {
      p.lat = lat;
      p.lon = lon;
    }
    const attrs: Record<string, unknown> = {};
    for (const f of editableFields) {
      const v = coerceFieldValue(f, draft.attributes[f.key]);
      if (!sameValue(v, record.attributes[f.key])) attrs[f.key] = v;
    }
    if (Object.keys(attrs).length) p.attributes = attrs;
    if ((draft.comments.trim() || null) !== (record.comments ?? null))
      p.comments = draft.comments.trim() || null;
    return Object.keys(p).length ? p : null;
  }, [record, draft, editableFields]);

  const dirty = patch !== null;

  function validate(): string | null {
    if (!draft || !record) return null;
    const lat = parseCoord(draft.lat);
    const lon = parseCoord(draft.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon))
      return 'Las coordenadas deben ser números (por ejemplo -33.560560 y -70.661440).';
    if ((lat === null) !== (lon === null))
      return 'Latitud y longitud van juntas: completa ambas o deja ambas vacías.';
    if (lat !== null && (lat < -90 || lat > 90 || lon! < -180 || lon! > 180))
      return 'Las coordenadas están fuera de rango.';
    if (record.layer.hasRole && draft.roleId.trim()) {
      const parsed = tryNormalizeRoleId(draft.roleId);
      if (!parsed.ok) return 'El rol debe tener el formato 00000-00000.';
    }
    for (const f of editableFields) {
      if (f.required && coerceFieldValue(f, draft.attributes[f.key]) === null)
        return `Completa el campo "${f.label}".`;
    }
    return null;
  }

  async function save() {
    if (!record || !patch) return;
    const err = validate();
    setValidation(err);
    if (err) return;
    setDuplicate(null);
    try {
      await update.mutateAsync({ id: record.id, patch });
    } catch (e) {
      if (isDuplicateConflict(e))
        setDuplicate({ message: e.message, existingRecordId: e.details.existingRecordId });
      else setValidation(errorMessage(e));
    }
  }

  async function confirmDelete() {
    if (!record) return;
    await remove.mutateAsync({
      id: record.id,
      layerId: record.layerId,
      reason: deleteReason.trim() || undefined,
    });
    setDeleteOpen(false);
    onClose();
  }

  if (detail.isPending) {
    return (
      <SidePanel title="Datos del registro" onClose={onClose}>
        <LoadingState rows={6} label="Cargando el registro…" />
      </SidePanel>
    );
  }
  if (detail.isError || !record || !draft) {
    return (
      <SidePanel title="Datos del registro" onClose={onClose}>
        <ErrorState
          title="No se pudo cargar el registro"
          message={errorMessage(detail.error)}
          onRetry={() => void detail.refetch()}
        />
      </SidePanel>
    );
  }

  const isOverlay = workingLayerId !== null && record.layerId !== workingLayerId;
  const hasCoords = record.lat !== null && record.lon !== null;
  const roleHasCoords = !!record.role && record.role.lat !== null && record.role.lon !== null;
  const number = autoField ? record.attributes[autoField.key] : undefined;
  const hasNumber = typeof number === 'number';
  const hasNumberAssigned = !!record.numberAssignedAt;
  const canDelete = canEdit && (!hasNumberAssigned || can('records.deleteNumbered'));
  const busy = update.isPending || remove.isPending || coords.isPending;

  return (
    <SidePanel
      title="Datos del registro"
      onClose={onClose}
      data-testid="record-panel"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <LayerIcon name={record.layer.icon} color={record.layer.iconColor} className="size-4" />
            {record.layer.name}
          </span>
          {isOverlay ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-sm"
              onClick={() => onWorkInLayer(record.layerId)}
            >
              Trabajar en esta capa
            </Button>
          ) : null}
        </span>
      }
      footer={
        <div className="space-y-3">
          {validation ? (
            <p role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          ) : null}
          {duplicate ? (
            <Alert variant="destructive">
              <AlertTitle>Ya existe un registro igual</AlertTitle>
              <AlertDescription>
                <p>{duplicate.message}</p>
                <Button
                  variant="outline"
                  size="lg"
                  className="mt-2"
                  onClick={() => onOpenRecord(duplicate.existingRecordId)}
                >
                  Abrir registro existente
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {canDelete ? (
              <Button
                variant="ghost"
                size="lg"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={busy}
              >
                <Trash2 aria-hidden /> Eliminar registro
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="lg" onClick={onClose} disabled={busy}>
                {dirty ? 'Cancelar' : 'Cerrar'}
              </Button>
              {canEdit ? (
                <Button size="lg" onClick={() => void save()} disabled={!dirty || busy}>
                  {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Guardar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {autoField ? (
          <section className="rounded-lg border bg-primary-soft/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-sm font-semibold text-primary-dark">
                <Hash className="size-4" aria-hidden /> {autoField.label}
                <HelpLink slug="registros/asignar-numero" label={`¿Cómo funciona el ${autoField.label}?`} />
              </p>
              {hasNumber && can('records.correctNumber') ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setCorrectValue(String(number));
                    setCorrectReason('');
                    setCorrectOpen(true);
                  }}
                >
                  Corregir número
                </Button>
              ) : null}
            </div>
            {hasNumber ? (
              <>
                <p className="mt-1 text-3xl font-bold text-primary-dark tabular-nums">{formatInt(number)}</p>
                {record.numberAssignedAt ? (
                  <p className="text-sm text-muted-foreground">
                    Asignado el {formatDateTime(record.numberAssignedAt)}
                    {record.numberAssignedBy ? ` por ${record.numberAssignedBy}` : ''}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Número histórico (importado).</p>
                )}
              </>
            ) : (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-base text-muted-foreground">Sin número asignado</p>
                {can('records.assignNumber') ? (
                  <Button
                    size="lg"
                    variant="secondary"
                    className="bg-secondary-strong text-white hover:bg-secondary-strong/90"
                    onClick={() => setAssignOpen(true)}
                  >
                    Asignar {autoField.label}
                  </Button>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {record.layer.hasRole ? (
          <PanelSection
            title={
              <>
                Rol SII <HelpLink slug="mapa/ficha-del-rol" label="¿Qué es el Rol SII?" />
              </>
            }
          >
            <Label htmlFor={`${ids}-rol`} className="text-base">
              Rol
            </Label>
            <RoleInput
              id={`${ids}-rol`}
              value={draft.roleId}
              onChange={(v) => setDraft({ ...draft, roleId: v })}
              onRoleResolved={setResolvedRole}
              disabled={!canEdit || busy}
            />
            {record.roleId ? (
              <Button
                variant="link"
                className="h-auto p-0 text-base"
                onClick={() => onOpenRole(record.roleId!)}
              >
                Ver ficha del rol ({record.sameRoleCount}{' '}
                {record.sameRoleCount === 1 ? 'registro' : 'registros'}){' '}
                <ExternalLink className="size-4" aria-hidden />
              </Button>
            ) : null}
            {record.roleLastOperation ? (
              <Alert className="border-amber-300 bg-amber-50">
                <AlertTitle className="text-amber-900">
                  {roleOperationTypeLabels[record.roleLastOperation.type]} del rol
                </AlertTitle>
                <AlertDescription className="text-amber-900">
                  <p>
                    {operationSentence(
                      record.roleLastOperation.type,
                      record.roleLastOperation.effectiveDate,
                      record.roleLastOperation.resultRoleIds,
                      record.roleLastOperation.reference,
                    )}{' '}
                    El registro conserva su rol original.
                  </p>
                  {record.roleId ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 text-amber-900 underline"
                      onClick={() => onOpenRole(record.roleId!)}
                    >
                      Ver la ficha del rol
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {record.backsOperation ? (
              <p className="text-sm text-muted-foreground">
                Este registro respalda la {roleOperationTypeLabels[record.backsOperation.type].toLowerCase()}{' '}
                de {record.backsOperation.originRoleIds.join(', ')}.
              </p>
            ) : null}
          </PanelSection>
        ) : null}

        <PanelSection
          title={
            <>
              Ubicación <HelpLink slug="registros/coordenadas" label="¿De dónde salen las coordenadas?" />
            </>
          }
          action={
            hasCoords ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => onCenter(record.lat!, record.lon!)}
              >
                <Crosshair aria-hidden /> Centrar
              </Button>
            ) : null
          }
        >
          {!hasCoords ? (
            <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <MapPinOff className="size-4 shrink-0" aria-hidden /> Sin ubicación: este registro solo aparece
              en la tabla. Escribe sus coordenadas para verlo en el mapa.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-lat`} className="text-base">
                Latitud
              </Label>
              <Input
                id={`${ids}-lat`}
                inputMode="decimal"
                className="h-11 text-base"
                value={draft.lat}
                onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
                disabled={!canEdit || busy}
                placeholder="-33.560560"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-lon`} className="text-base">
                Longitud
              </Label>
              <Input
                id={`${ids}-lon`}
                inputMode="decimal"
                className="h-11 text-base"
                value={draft.lon}
                onChange={(e) => setDraft({ ...draft, lon: e.target.value })}
                disabled={!canEdit || busy}
                placeholder="-70.661440"
              />
            </div>
          </div>
          {record.coordsSource ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="rounded-md text-sm">
                {coordsSourceLabels[record.coordsSource]}
                {record.coordsSource === 'geocoded' && record.geocode
                  ? ` · ${geocodeConfidenceLabels[record.geocode.confidence]}`
                  : ''}
              </Badge>
              {canEdit && record.roleId && roleHasCoords && record.coordsSource !== 'role' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={busy}
                  onClick={() =>
                    void coords.mutateAsync({
                      id: record.id,
                      layerId: record.layerId,
                      input: { useRole: true },
                    })
                  }
                >
                  <LocateFixed aria-hidden /> Usar coordenadas del rol
                </Button>
              ) : null}
            </div>
          ) : null}
          {resolvedRole &&
          resolvedRole.id !== record.roleId &&
          resolvedRole.lat !== null &&
          record.coordsSource !== 'own' ? (
            <p className="text-sm text-muted-foreground">
              Al guardar, las coordenadas se tomarán del nuevo rol.
            </p>
          ) : null}
        </PanelSection>

        {editableFields.length ? (
          <PanelSection title="Datos de la capa">
            <div className="space-y-4">
              {editableFields.map((f) => {
                const current = formatFieldValue(record.attributes[f.key], f.type);
                return (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`${ids}-${f.key}`} className="text-base">
                      {f.label}
                      {f.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <FieldInput
                      id={`${ids}-${f.key}`}
                      field={f}
                      value={draft.attributes[f.key] ?? ''}
                      onChange={(v) =>
                        setDraft({ ...draft, attributes: { ...draft.attributes, [f.key]: v } })
                      }
                      disabled={!canEdit || busy}
                    />
                    {current ? <p className="text-sm text-muted-foreground">Actual: {current}</p> : null}
                  </div>
                );
              })}
            </div>
          </PanelSection>
        ) : null}

        <PanelSection title="Comentarios">
          <Label htmlFor={`${ids}-comments`} className="sr-only">
            Comentarios
          </Label>
          <Textarea
            id={`${ids}-comments`}
            value={draft.comments}
            onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
            disabled={!canEdit || busy}
            placeholder="Sin comentarios"
            className="min-h-24 text-base"
          />
        </PanelSection>

        <PanelSection title="Adjuntos">
          <AttachmentsList
            entityType="record"
            entityId={String(record.id)}
            canEdit={can('attachments.write')}
          />
        </PanelSection>

        <p className="text-xs text-muted-foreground">
          Registro #{record.id} · Actualizado el {formatDateTime(record.updatedAt)}
        </p>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar este registro"
        destructive
        pending={remove.isPending}
        disabled={hasNumberAssigned && deleteReason.trim().length < 3}
        confirmLabel="Eliminar registro"
        onConfirm={confirmDelete}
        description={
          <div className="space-y-2">
            <p>
              Se eliminará el registro {record.roleId ? `del rol ${record.roleId} ` : ''}de la capa “
              {record.layer.name}”, junto con sus comentarios y adjuntos. Esta acción no se puede deshacer.
            </p>
            {hasNumberAssigned ? (
              <p className="text-amber-900">
                Este registro tiene el número {formatInt(number as number)} asignado. El número no se
                reutilizará; se recomienda marcarlo como anulado en vez de borrarlo.
              </p>
            ) : null}
          </div>
        }
      >
        {hasNumberAssigned ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-del-reason`} className="text-base">
              Motivo (obligatorio)
            </Label>
            <Input
              id={`${ids}-del-reason`}
              className="h-11 text-base"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Por ejemplo: registro duplicado"
            />
          </div>
        ) : null}
      </ConfirmDialog>

      {autoField ? (
        <ConfirmDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          title={`Asignar ${autoField.label}`}
          confirmLabel={`Asignar ${autoField.label}`}
          pending={assign.isPending}
          onConfirm={async () => {
            await assign.mutateAsync({ id: record.id, layerId: record.layerId });
            setAssignOpen(false);
          }}
          description={
            <div className="space-y-2">
              {counters.isPending && can('records.assignNumber') ? (
                <p className="text-muted-foreground">Calculando el próximo número…</p>
              ) : nextNumber !== null ? (
                <p>
                  Se asignará el <strong>N° {formatInt(nextNumber)}</strong> (número referencial; el
                  definitivo se confirma al guardar).
                </p>
              ) : (
                <p>Se asignará el próximo número disponible de la capa.</p>
              )}
              <p>Asigna el número solo cuando el permiso esté aprobado y los derechos pagados.</p>
              <p className="font-medium">Esta acción no se puede deshacer.</p>
            </div>
          }
        />
      ) : null}

      {autoField ? (
        <ConfirmDialog
          open={correctOpen}
          onOpenChange={setCorrectOpen}
          title={`Corregir ${autoField.label}`}
          confirmLabel="Guardar corrección"
          pending={correct.isPending}
          disabled={
            correctReason.trim().length < 3 ||
            (correctValue.trim() !== '' && !/^\d+$/.test(correctValue.trim()))
          }
          onConfirm={async () => {
            await correct.mutateAsync({
              id: record.id,
              layerId: record.layerId,
              value: correctValue.trim() === '' ? null : Number(correctValue.trim()),
              reason: correctReason.trim(),
            });
            setCorrectOpen(false);
          }}
          description={
            <p>
              Solo para números mal puestos o entregados fuera de la plataforma. La corrección queda
              registrada en la auditoría con tu nombre y el motivo.
            </p>
          }
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-correct-value`} className="text-base">
                Número correcto (vacío para quitarlo)
              </Label>
              <Input
                id={`${ids}-correct-value`}
                inputMode="numeric"
                className="h-11 text-base"
                value={correctValue}
                onChange={(e) => setCorrectValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-correct-reason`} className="text-base">
                Motivo (obligatorio)
              </Label>
              <Input
                id={`${ids}-correct-reason`}
                className="h-11 text-base"
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
                placeholder="Por ejemplo: número entregado en Excel"
              />
            </div>
          </div>
        </ConfirmDialog>
      ) : null}
    </SidePanel>
  );
}
