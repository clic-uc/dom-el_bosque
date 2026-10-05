'use client';

import { Loader2, MapPin, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { LayerIcon } from '@/components/shared/layer-icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { HelpLink } from '@/features/help/HelpLink';
import { geocodeQueryOptions, isDuplicateConflict, useCreateRecord } from '@/features/map/hooks';
import { RoleInput } from '@/features/roles/RoleInput';
import { errorMessage } from '@/lib/api';
import { formatCoord, formatDate } from '@/lib/format';
import { geocodeConfidenceLabels } from '@/shared/constants';
import { createRecordSchema } from '@/shared/schemas/records';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { GeocodeResult, LayerWithCount, RecordDetail, RoleDto } from '@/shared/types';
import { coerceFieldValue, FieldInput, type FieldValue } from './FieldInput';

type Props = {
  /**
   * El diálogo permanece montado mientras `open` sea true, aunque esté minimizado para elegir en el mapa.
   * El contenedor lo monta con una `key` nueva en cada apertura, así el formulario parte limpio.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layers: LayerWithCount[];
  defaultLayerId: number | null;
  /** Modo "Seleccionar en el mapa" activo: el diálogo se oculta y el mapa muestra la barra flotante. */
  pickActive: boolean;
  pickedLocation: { lat: number; lon: number; at: number } | null;
  onRequestPick: () => void;
  onOpenRecord: (recordId: number) => void;
  onCreated: (record: RecordDetail) => void;
};

function parseCoord(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const ROLE_COORDS_NOTE = 'Coordenadas del rol cargadas automáticamente.';

/** Crear registro (§10.2, §8.3). */
export function CreateRecordDialog({
  open,
  onOpenChange,
  layers,
  defaultLayerId,
  pickActive,
  pickedLocation,
  onRequestPick,
  onOpenRecord,
  onCreated,
}: Props) {
  const id = useId();
  const create = useCreateRecord();
  const queryClient = useQueryClient();
  const [layerId, setLayerId] = useState<number | null>(defaultLayerId ?? layers[0]?.id ?? null);
  const [roleId, setRoleId] = useState('');
  const [role, setRole] = useState<RoleDto | null>(null);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [coordsNote, setCoordsNote] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<Record<string, FieldValue>>({});
  const [comments, setComments] = useState('');
  const [address, setAddress] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResult | null | undefined>(undefined);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ message: string; existingRecordId: number } | null>(null);

  const layer = useMemo(() => layers.find((l) => l.id === layerId) ?? null, [layers, layerId]);
  const fields = useMemo(() => layer?.fields.filter((f) => f.type !== 'autonumber') ?? [], [layer]);

  // Ubicación elegida en el mapa: se aplica una vez por clic (ajuste de estado durante el render).
  const [appliedPickAt, setAppliedPickAt] = useState<number | null>(null);
  if (pickedLocation && pickedLocation.at !== appliedPickAt) {
    setAppliedPickAt(pickedLocation.at);
    setLat(formatCoord(pickedLocation.lat));
    setLon(formatCoord(pickedLocation.lon));
    setCoordsNote('Ubicación seleccionada en el mapa.');
  }

  /** Rol existente con coordenadas → autocompletar, salvo que el usuario ya haya escrito coordenadas propias. */
  function handleRoleResolved(next: RoleDto | null) {
    setRole(next);
    if (!next || next.lat === null || next.lon === null) return;
    if (lat.trim() && lon.trim() && coordsNote !== ROLE_COORDS_NOTE) return;
    setLat(formatCoord(next.lat));
    setLon(formatCoord(next.lon));
    setCoordsNote(ROLE_COORDS_NOTE);
  }

  async function searchAddress() {
    const q = address.trim();
    if (q.length < 3) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const r = await queryClient.fetchQuery(geocodeQueryOptions(q));
      setGeocodeResult(r);
      if (r) {
        setLat(formatCoord(r.lat));
        setLon(formatCoord(r.lon));
        setCoordsNote(
          `Ubicación por dirección: ${r.label} (${geocodeConfidenceLabels[r.confidence].toLowerCase()}).`,
        );
      }
    } catch (err) {
      setGeocodeError(errorMessage(err));
    } finally {
      setGeocoding(false);
    }
  }

  function setAttr(key: string, v: FieldValue) {
    setAttributes((a) => ({ ...a, [key]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicate(null);
    if (!layer) {
      setError('Elige la capa donde se guardará el registro.');
      return;
    }
    const nLat = parseCoord(lat);
    const nLon = parseCoord(lon);
    if (nLat === null || nLon === null) {
      setError(
        'La ubicación es obligatoria: escribe latitud y longitud, selecciónala en el mapa o busca la dirección.',
      );
      return;
    }
    if (Number.isNaN(nLat) || Number.isNaN(nLon)) {
      setError('Las coordenadas deben ser números (por ejemplo -33.560560 y -70.661440).');
      return;
    }
    let normalizedRole: string | null = null;
    if (layer.hasRole && roleId.trim()) {
      const parsed = tryNormalizeRoleId(roleId);
      if (!parsed.ok) {
        setError('El rol debe tener el formato 00000-00000.');
        return;
      }
      normalizedRole = parsed.value;
    }
    const attrs: Record<string, unknown> = {};
    for (const f of fields) {
      const v = coerceFieldValue(f, attributes[f.key]);
      if (f.required && v === null) {
        setError(`Completa el campo "${f.label}".`);
        return;
      }
      if (v !== null) attrs[f.key] = v;
    }
    const parsed = createRecordSchema.safeParse({
      layerId: layer.id,
      roleId: layer.hasRole ? normalizedRole : undefined,
      lat: nLat,
      lon: nLon,
      attributes: attrs,
      comments: comments.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    try {
      const record = await create.mutateAsync(parsed.data);
      onCreated(record);
      onOpenChange(false);
    } catch (err) {
      if (isDuplicateConflict(err))
        setDuplicate({ message: err.message, existingRecordId: err.details.existingRecordId });
      else setError(errorMessage(err));
    }
  }

  const busy = create.isPending;
  const currentRole = tryNormalizeRoleId(roleId);
  const geocodeRole =
    geocodeResult?.roleId &&
    layer?.hasRole &&
    geocodeResult.confidence === 'exact' &&
    !(currentRole.ok && currentRole.value === geocodeResult.roleId)
      ? geocodeResult.roleId
      : null;

  return (
    <Dialog open={open && !pickActive} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)} className="space-y-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1 text-xl">
              Crear registro <HelpLink slug="registros/crear-y-editar" label="¿Cómo se crea un registro?" />
            </DialogTitle>
            <DialogDescription className="text-base">
              Los campos con * son obligatorios. Los adjuntos se agregan después, desde el panel del registro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-layer`} className="text-base">
              Capa *
            </Label>
            <Select
              value={layerId ? String(layerId) : ''}
              onValueChange={(v) => setLayerId(Number(v))}
              disabled={busy}
            >
              <SelectTrigger id={`${id}-layer`} className="h-11 w-full text-base">
                <SelectValue placeholder="Elige una capa" />
              </SelectTrigger>
              <SelectContent>
                {layers.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)} className="min-h-11 text-base">
                    <span className="flex items-center gap-2">
                      <LayerIcon name={l.icon} color={l.iconColor} className="size-4" /> {l.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {layer?.hasRole ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-role`} className="text-base">
                Rol SII
              </Label>
              <RoleInput
                id={`${id}-role`}
                value={roleId}
                onChange={setRoleId}
                onRoleResolved={handleRoleResolved}
                disabled={busy}
              />
              {role && !role.vigente ? (
                <Alert className="border-amber-300 bg-amber-50">
                  <AlertTitle className="text-amber-900">Rol no vigente</AlertTitle>
                  <AlertDescription className="text-amber-900">
                    <p>
                      El rol {role.id} dejó de estar vigente
                      {role.supersededAt ? ` el ${formatDate(role.supersededAt)}` : ''}
                      {role.resultRoleIds?.length
                        ? `; fue reemplazado por ${role.resultRoleIds.join(', ')}`
                        : ''}
                      . Si el permiso es nuevo, usa un rol resultante; si es antiguo, puedes continuar.
                    </p>
                    {role.resultRoleIds?.length ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {role.resultRoleIds.map((r) => (
                          <Button
                            key={r}
                            type="button"
                            variant="outline"
                            size="lg"
                            className="h-10 font-mono"
                            onClick={() => setRoleId(r)}
                          >
                            Usar {r}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-base font-medium">Ubicación *</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-lat`} className="text-base">
                  Latitud
                </Label>
                <Input
                  id={`${id}-lat`}
                  inputMode="decimal"
                  className="h-11 text-base"
                  value={lat}
                  onChange={(e) => {
                    setLat(e.target.value);
                    setCoordsNote(null);
                  }}
                  placeholder="-33.560560"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-lon`} className="text-base">
                  Longitud
                </Label>
                <Input
                  id={`${id}-lon`}
                  inputMode="decimal"
                  className="h-11 text-base"
                  value={lon}
                  onChange={(e) => {
                    setLon(e.target.value);
                    setCoordsNote(null);
                  }}
                  placeholder="-70.661440"
                  disabled={busy}
                />
              </div>
            </div>
            {coordsNote ? <p className="text-sm text-secondary-strong">{coordsNote}</p> : null}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={onRequestPick}
              disabled={busy}
            >
              <MapPin aria-hidden /> Seleccionar en el mapa
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-address`} className="text-base">
                Buscar dirección
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`${id}-address`}
                  className="h-11 text-base"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Por ejemplo: Av. Padre Hurtado 1234"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void searchAddress();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-11"
                  onClick={() => void searchAddress()}
                  disabled={busy || geocoding || address.trim().length < 3}
                >
                  {geocoding ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}{' '}
                  Buscar
                </Button>
              </div>
              {!geocoding && geocodeResult === null ? (
                <p className="text-sm text-muted-foreground">
                  No encontramos esa dirección. Revisa la calle y el número, o selecciona el punto en el mapa.
                </p>
              ) : null}
              {geocodeError ? <p className="text-sm text-destructive">{geocodeError}</p> : null}
              {geocodeRole ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>La dirección corresponde al rol {geocodeRole} del padrón.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 font-mono"
                    onClick={() => setRoleId(geocodeRole)}
                  >
                    Usar el rol {geocodeRole}
                  </Button>
                </div>
              ) : null}
            </div>
          </fieldset>

          {fields.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`${id}-${f.key}`} className="text-base">
                    {f.label}
                    {f.required ? ' *' : ''}
                  </Label>
                  <FieldInput
                    id={`${id}-${f.key}`}
                    field={f}
                    value={attributes[f.key] ?? (f.type === 'boolean' ? false : '')}
                    onChange={(v) => setAttr(f.key, v)}
                    disabled={busy}
                  />
                </div>
              ))}
            </div>
          ) : null}
          {layer?.fields.some((f) => f.type === 'autonumber') ? (
            <p className="text-sm text-muted-foreground">
              El {layer.fields.find((f) => f.type === 'autonumber')!.label} se asigna después, desde el panel
              del registro, cuando el permiso esté aprobado.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-comments`} className="text-base">
              Comentarios
            </Label>
            <Textarea
              id={`${id}-comments`}
              className="min-h-20 text-base"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              disabled={busy}
              maxLength={5000}
            />
          </div>

          {error ? (
            <p role="alert" className="text-base text-destructive">
              {error}
            </p>
          ) : null}
          {duplicate ? (
            <Alert variant="destructive">
              <AlertTitle>Ya existe un registro igual</AlertTitle>
              <AlertDescription>
                <p>{duplicate.message}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="mt-2"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenRecord(duplicate.existingRecordId);
                  }}
                >
                  Abrir registro existente
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" size="lg" disabled={busy || !layer}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} Crear registro
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
