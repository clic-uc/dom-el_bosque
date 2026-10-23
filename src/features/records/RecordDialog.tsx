'use client';

import { ChevronRight, Hash, Loader2, LocateFixed, MapPin, MapPinOff, Pencil, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EntityDialog } from '@/components/shared/entity-dialog';
import { LayerIcon } from '@/components/shared/layer-icon';
import { ErrorState, LoadingState } from '@/components/shared/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentsList } from '@/features/attachments/AttachmentsList';
import { useCan } from '@/features/auth/actor-context';
import { HelpLink } from '@/features/help/HelpLink';
import {
  isDuplicateConflict,
  useAssignNumber,
  useCorrectNumber,
  useDeleteRecord,
  useLayerCounters,
  useRecordDetail,
  useUpdateCoordinates,
  useUpdateRecord,
} from '@/features/map/hooks';
import { PanelSection } from '@/features/map/SidePanel';
import { RoleInput, RoleStatusBadge } from '@/features/roles/RoleInput';
import { errorMessage } from '@/lib/api';
import { formatCoord, formatDate, formatDateTime, formatFieldValue, formatInt } from '@/lib/format';
import { coordsSourceLabels, geocodeConfidenceLabels, roleOperationTypeLabels } from '@/shared/constants';
import type { UpdateRecordInput } from '@/shared/schemas/records';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { LayerField, RecordDetail, RoleDto } from '@/shared/types';
import { coerceFieldValue, FieldInput, toFieldValue, type FieldValue } from './FieldInput';

type Props = {
  recordId: number;
  workingLayerId: number | null;
  onClose: () => void;
  onOpenRole: (roleId: string) => void;
  onOpenRecord: (recordId: number) => void;
  onWorkInLayer: (layerId: number) => void;
  /** Cierra la ficha dejando el registro seleccionado en el mapa, centrado en (lat, lon). */
  onViewOnMap: (lat: number, lon: number) => void;
  /** Ficha desde la que se llegó (por ejemplo, la del rol). */
  back?: { label: string; onBack: () => void } | null;
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

/** Primer campo de la capa que parece una dirección: identifica el registro en el encabezado. */
function addressOf(record: RecordDetail): string {
  const field = record.layer.fields.find((f) => f.type === 'string' && /direcci[oó]n/i.test(f.label));
  const value = field ? formatFieldValue(record.attributes[field.key], field.type) : '';
  return value || record.role?.address || '';
}

/** Ficha del registro: se abre para leer; "Editar datos" la cambia a formulario en el mismo lugar. */
export function RecordDialog({
  recordId,
  workingLayerId,
  onClose,
  onOpenRole,
  onOpenRecord,
  onWorkInLayer,
  onViewOnMap,
  back,
}: Props) {
  const can = useCan();
  const canEdit = can('records.write');
  const ids = useId();
  const detail = useRecordDetail(recordId);
  const record = detail.data;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftKey, setDraftKey] = useState<string>('');
  const [resolvedRole, setResolvedRole] = useState<RoleDto | null>(null);
  const [duplicate, setDuplicate] = useState<{ message: string; existingRecordId: number } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  /** Acción que espera confirmar "Descartar cambios" (cerrar, abrir otro registro). */
  const [discardThen, setDiscardThen] = useState<(() => void) | null>(null);
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

  function startEditing() {
    if (record) setDraft(draftFrom(record));
    setEditing(true);
  }

  function stopEditing() {
    if (record) setDraft(draftFrom(record));
    setValidation(null);
    setDuplicate(null);
    setEditing(false);
  }

  /** Sale de la ficha; con cambios sin guardar, pide confirmar antes. */
  function leave(action: () => void) {
    if (editing && dirty) setDiscardThen(() => action);
    else action();
  }

  function requestClose() {
    leave(onClose);
  }

  async function save() {
    if (!record || !patch) return;
    const err = validate();
    setValidation(err);
    if (err) return;
    setDuplicate(null);
    try {
      await update.mutateAsync({ id: record.id, patch });
      setEditing(false);
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
      <EntityDialog
        title="Ficha del registro"
        onRequestClose={onClose}
        back={back}
        data-testid="record-dialog"
      >
        <LoadingState rows={6} label="Cargando el registro…" />
      </EntityDialog>
    );
  }
  if (detail.isError || !record || !draft) {
    return (
      <EntityDialog
        title="Ficha del registro"
        onRequestClose={onClose}
        back={back}
        data-testid="record-dialog"
      >
        <ErrorState
          title="No se pudo cargar el registro"
          message={errorMessage(detail.error)}
          onRetry={() => void detail.refetch()}
        />
      </EntityDialog>
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
  const address = addressOf(record);
  const roleTotal = record.sameRoleCount + 1;

  const filledFields = editableFields.filter(
    (f) => formatFieldValue(record.attributes[f.key], f.type) !== '',
  );
  const emptyFields = editableFields.filter((f) => formatFieldValue(record.attributes[f.key], f.type) === '');

  const title = record.roleId ? (
    <>
      Rol <span className="font-mono">{record.roleId}</span>
    </>
  ) : hasNumber && autoField ? (
    `${autoField.label} ${formatInt(number)}`
  ) : (
    `Registro #${record.id}`
  );

  const dataSection = (
    <PanelSection title={`Datos de ${record.layer.name}`}>
      {editableFields.length === 0 ? (
        <p className="text-base text-muted-foreground">Esta capa no tiene campos propios.</p>
      ) : editing ? (
        <div className="space-y-4">
          {editableFields.map((f) => {
            const changed = !sameValue(
              coerceFieldValue(f, draft.attributes[f.key]),
              record.attributes[f.key],
            );
            const before = formatFieldValue(record.attributes[f.key], f.type);
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
                  onChange={(v) => setDraft({ ...draft, attributes: { ...draft.attributes, [f.key]: v } })}
                  disabled={busy}
                />
                {changed ? (
                  <p className="text-sm text-muted-foreground">Antes: {before || 'sin completar'}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {filledFields.length ? (
            <dl className="divide-y">
              {filledFields.map((f) => (
                <div
                  key={f.key}
                  className="grid gap-0.5 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4"
                >
                  <dt className="text-base text-muted-foreground">{f.label}</dt>
                  <dd className="text-base font-medium break-words">
                    {formatFieldValue(record.attributes[f.key], f.type)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-base text-muted-foreground">Todavía no tiene datos completados.</p>
          )}
          {emptyFields.length ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="group h-11 gap-2 px-2 text-base font-normal text-muted-foreground"
                >
                  <ChevronRight
                    className="size-5 transition-transform group-data-[state=open]:rotate-90"
                    aria-hidden
                  />
                  {emptyFields.length === 1
                    ? '1 campo sin completar'
                    : `${emptyFields.length} campos sin completar`}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="space-y-1 pl-9 text-base text-muted-foreground">
                  {emptyFields.map((f) => (
                    <li key={f.key}>{f.label}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      )}
    </PanelSection>
  );

  const commentsSection = (
    <PanelSection title="Comentarios">
      {editing ? (
        <>
          <Label htmlFor={`${ids}-comments`} className="sr-only">
            Comentarios
          </Label>
          <Textarea
            id={`${ids}-comments`}
            value={draft.comments}
            onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
            disabled={busy}
            placeholder="Escribe aquí un comentario sobre este registro"
            className="min-h-24 text-base"
          />
        </>
      ) : record.comments ? (
        <p className="text-base whitespace-pre-wrap">{record.comments}</p>
      ) : (
        <p className="text-base text-muted-foreground">Sin comentarios.</p>
      )}
    </PanelSection>
  );

  const numberCard = autoField ? (
    <section className="rounded-lg border bg-primary-soft/60 p-4">
      <p className="flex items-center gap-1 text-base font-semibold text-primary-dark">
        <Hash className="size-4" aria-hidden /> {autoField.label}
        <HelpLink slug="registros/asignar-numero" label={`¿Cómo funciona el ${autoField.label}?`} />
      </p>
      {hasNumber ? (
        <>
          <p className="mt-1 text-4xl font-bold text-primary-dark tabular-nums">{formatInt(number)}</p>
          <p className="text-sm text-muted-foreground">
            {record.numberAssignedAt
              ? `Asignado el ${formatDateTime(record.numberAssignedAt)}${record.numberAssignedBy ? ` por ${record.numberAssignedBy}` : ''}.`
              : 'Número histórico (importado).'}
          </p>
          {!editing && can('records.correctNumber') ? (
            <Button
              variant="outline"
              className="mt-3 h-11 w-full"
              onClick={() => {
                setCorrectValue(String(number));
                setCorrectReason('');
                setCorrectOpen(true);
              }}
            >
              Corregir número
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-1 text-base text-muted-foreground">Sin número asignado.</p>
          {!editing && can('records.assignNumber') ? (
            <Button className="mt-3 h-11 w-full" onClick={() => setAssignOpen(true)}>
              Asignar {autoField.label}
            </Button>
          ) : null}
        </>
      )}
    </section>
  ) : null;

  const roleSection = record.layer.hasRole ? (
    <PanelSection
      title={
        <>
          Rol SII <HelpLink slug="mapa/ficha-del-rol" label="¿Qué es el Rol SII?" />
        </>
      }
    >
      {editing ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-rol`} className="text-base">
            Rol
          </Label>
          <RoleInput
            id={`${ids}-rol`}
            value={draft.roleId}
            onChange={(v) => setDraft({ ...draft, roleId: v })}
            onRoleResolved={setResolvedRole}
            disabled={busy}
          />
          {resolvedRole &&
          resolvedRole.id !== record.roleId &&
          resolvedRole.lat !== null &&
          record.coordsSource !== 'own' ? (
            <p className="text-sm text-muted-foreground">
              Al guardar, las coordenadas se tomarán del nuevo rol.
            </p>
          ) : null}
        </div>
      ) : record.roleId ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg">{record.roleId}</span>
            {record.role ? (
              record.role.vigente ? (
                <Badge className="rounded-md bg-secondary-soft text-secondary-strong" variant="outline">
                  Vigente
                </Badge>
              ) : (
                <RoleStatusBadge status="superseded" />
              )
            ) : (
              <RoleStatusBadge status="new" />
            )}
          </div>
          {record.role?.address ? (
            <p className="text-base text-muted-foreground">En el padrón: {record.role.address}</p>
          ) : null}
          {record.roleLastOperation ? (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertTitle className="text-amber-900">
                {roleOperationTypeLabels[record.roleLastOperation.type]} del rol
              </AlertTitle>
              <AlertDescription className="text-amber-900">
                {operationSentence(
                  record.roleLastOperation.type,
                  record.roleLastOperation.effectiveDate,
                  record.roleLastOperation.resultRoleIds,
                  record.roleLastOperation.reference,
                )}{' '}
                El registro conserva su rol original.
              </AlertDescription>
            </Alert>
          ) : null}
          {record.backsOperation ? (
            <p className="text-sm text-muted-foreground">
              Este registro respalda la {roleOperationTypeLabels[record.backsOperation.type].toLowerCase()} de{' '}
              {record.backsOperation.originRoleIds.join(', ')}.
            </p>
          ) : null}
          <Button variant="outline" className="h-11 w-full" onClick={() => onOpenRole(record.roleId!)}>
            Ver ficha del rol
          </Button>
          <p className="text-sm text-muted-foreground">
            {roleTotal === 1
              ? 'Solo este registro tiene este rol.'
              : `${roleTotal} registros tienen este rol.`}
          </p>
        </div>
      ) : (
        <p className="text-base text-muted-foreground">Sin rol asignado.</p>
      )}
    </PanelSection>
  ) : null;

  const locationSection = (
    <PanelSection
      title={
        <>
          Ubicación <HelpLink slug="registros/coordenadas" label="¿De dónde salen las coordenadas?" />
        </>
      }
    >
      {editing ? (
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
              disabled={busy}
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
              disabled={busy}
              placeholder="-70.661440"
            />
          </div>
        </div>
      ) : hasCoords ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-sm text-muted-foreground">Latitud</dt>
              <dd className="text-base tabular-nums">{formatCoord(record.lat!)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Longitud</dt>
              <dd className="text-base tabular-nums">{formatCoord(record.lon!)}</dd>
            </div>
          </dl>
          {record.coordsSource ? (
            <p className="text-sm text-muted-foreground">
              Origen: {coordsSourceLabels[record.coordsSource].toLowerCase()}
              {record.coordsSource === 'geocoded' && record.geocode
                ? ` (${geocodeConfidenceLabels[record.geocode.confidence].toLowerCase()})`
                : ''}
              .
            </p>
          ) : null}
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => onViewOnMap(record.lat!, record.lon!)}
          >
            <MapPin aria-hidden /> Ver en el mapa
          </Button>
        </div>
      ) : (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-base">
          <MapPinOff className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            Sin ubicación: este registro solo aparece en la tabla.
            {canEdit ? ' Usa “Editar datos” para escribir sus coordenadas.' : ''}
          </span>
        </p>
      )}
      {!editing && canEdit && record.roleId && roleHasCoords && record.coordsSource !== 'role' ? (
        <Button
          variant="ghost"
          className="h-11 w-full"
          disabled={busy}
          onClick={() =>
            void coords.mutateAsync({ id: record.id, layerId: record.layerId, input: { useRole: true } })
          }
        >
          <LocateFixed aria-hidden /> Usar las coordenadas del rol
        </Button>
      ) : null}
    </PanelSection>
  );

  const footer = (
    <div className="space-y-3">
      {validation ? (
        <p role="alert" className="text-base text-destructive">
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
              className="mt-2 h-11"
              onClick={() => leave(() => onOpenRecord(duplicate.existingRecordId))}
            >
              Abrir registro existente
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!editing && canDelete ? (
          <Button
            variant="ghost"
            size="lg"
            className="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
          >
            <Trash2 aria-hidden /> Eliminar registro
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="lg" className="h-11" onClick={stopEditing} disabled={busy}>
                Cancelar
              </Button>
              <Button size="lg" className="h-11" onClick={() => void save()} disabled={!dirty || busy}>
                {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Guardar cambios
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="lg" className="h-11" onClick={onClose}>
                Cerrar
              </Button>
              {canEdit ? (
                <Button size="lg" className="h-11" onClick={startEditing}>
                  <Pencil aria-hidden /> Editar datos
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <EntityDialog
      data-testid="record-dialog"
      title={title}
      back={editing ? null : back}
      onRequestClose={requestClose}
      eyebrow={
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <LayerIcon name={record.layer.icon} color={record.layer.iconColor} className="size-5" />
            {record.layer.name}
          </span>
          {isOverlay && !editing ? (
            <Button
              variant="link"
              className="h-auto p-0 text-base"
              onClick={() => onWorkInLayer(record.layerId)}
            >
              Trabajar en esta capa
            </Button>
          ) : null}
          {editing ? (
            <Badge variant="outline" className="rounded-md border-primary/40 text-sm text-primary-dark">
              Editando
            </Badge>
          ) : null}
        </p>
      }
      subtitle={address && address !== record.roleId ? <p className="text-lg">{address}</p> : null}
      footer={footer}
    >
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-8">
          {dataSection}
          {commentsSection}
        </div>
        <aside className="space-y-8" aria-label="Número, rol, ubicación y adjuntos">
          {numberCard}
          {roleSection}
          {locationSection}
          <PanelSection title="Adjuntos">
            <AttachmentsList
              entityType="record"
              entityId={String(record.id)}
              canEdit={can('attachments.write')}
            />
          </PanelSection>
          <p className="text-sm text-muted-foreground">
            Registro #{record.id}. Actualizado el {formatDateTime(record.updatedAt)}.
          </p>
        </aside>
      </div>

      <ConfirmDialog
        open={discardThen !== null}
        onOpenChange={(open) => !open && setDiscardThen(null)}
        title="Descartar los cambios"
        description="Los cambios que hiciste en este registro no se guardarán."
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        destructive
        onConfirm={() => {
          const action = discardThen;
          setDiscardThen(null);
          action?.();
        }}
      />

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
    </EntityDialog>
  );
}

/**
 * Aviso flotante sobre el mapa mientras la ficha está cerrada con "Ver en el mapa": el registro sigue
 * seleccionado (se puede arrastrar su círculo para moverlo) y se vuelve a la ficha con un clic.
 */
export function RecordPeekBar({
  recordId,
  onOpen,
  onClose,
}: {
  recordId: number;
  onOpen: () => void;
  onClose: () => void;
}) {
  const can = useCan();
  const { data: record, isError } = useRecordDetail(recordId);
  if (!record) {
    // Si el registro ya no se puede cargar (p. ej. lo eliminaron), igual se puede quitar la selección.
    return isError ? (
      <div className="pointer-events-none absolute inset-x-0 bottom-10 z-(--z-index-map-controls) flex justify-center px-4">
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg"
        >
          <p className="text-base">No se pudo cargar el registro seleccionado.</p>
          <Button variant="outline" size="lg" className="h-11" onClick={onClose}>
            Quitar la selección
          </Button>
        </div>
      </div>
    ) : null;
  }
  const label = record.roleId
    ? `${record.layer.name}, rol ${record.roleId}`
    : `${record.layer.name}, registro #${record.id}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-(--z-index-map-controls) flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg"
      >
        <LayerIcon name={record.layer.icon} color={record.layer.iconColor} className="size-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-medium">{label}</p>
          {can('records.write') && record.lat !== null ? (
            <p className="text-sm text-muted-foreground">
              Arrastra el círculo punteado para mover la ubicación.
            </p>
          ) : null}
        </div>
        <Button size="lg" className="h-11" onClick={onOpen}>
          Volver a la ficha
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          onClick={onClose}
          aria-label="Quitar la selección del registro"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
