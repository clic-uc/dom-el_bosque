'use client';

import { AlertTriangle, CircleCheck, Info, Loader2, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatFieldValue } from '@/lib/format';
import { cn } from '@/lib/utils';
import { geocodeConfidenceLabels } from '@/shared/constants';
import type { GeocodeCandidate } from '@/shared/schemas/geocode';
import type { ImportRowPatch, ImportRowStatus } from '@/shared/schemas/imports';
import type { ImportMessage, ImportRemovalDto, ImportRowDto, ImportStatusFull } from '@/shared/types';

/** Piezas de la tabla de revisión (§10.2 paso 3). */

export type PatchFn = (rowNumber: number, patch: ImportRowPatch) => Promise<unknown>;

const isOverrideKey = (k: string) => k.startsWith('__');

function levelIcon(level: ImportMessage['level']) {
  if (level === 'error')
    return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Error" />;
  if (level === 'warning')
    return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Advertencia" />;
  return <Info className="mt-0.5 size-4 shrink-0 text-sky-600" aria-label="Información" />;
}

/** Celda editable: guarda al salir del campo o con Enter si cambió (PATCH raw → la fila se revalida sola). */
function EditableCell({
  header,
  rowNumber,
  value,
  invalid,
  onSave,
}: {
  header: string;
  rowNumber: number;
  value: string;
  invalid?: boolean;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setDraft(value);
  }
  async function commit() {
    if (draft === value) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="relative">
      <Input
        aria-label={`${header}, fila ${rowNumber}`}
        aria-invalid={invalid || undefined}
        className={cn('h-10 min-w-36 text-base', invalid && 'border-destructive bg-destructive/5')}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(value);
        }}
      />
      {saving ? (
        <Loader2 className="absolute top-3 right-2 size-4 animate-spin text-muted-foreground" aria-hidden />
      ) : null}
    </div>
  );
}

function candidatesOf(m: ImportMessage): GeocodeCandidate[] {
  return (m.data?.candidates as GeocodeCandidate[] | undefined) ?? [];
}

/** Mensajes de una fila con sus acciones (aceptar sugerencias, elegir candidato, fijar ubicación). */
function RowMessages({
  row,
  layerHasRole,
  onPatch,
}: {
  row: ImportRowDto;
  layerHasRole: boolean;
  onPatch: PatchFn;
}) {
  const [manual, setManual] = useState<{ lat: string; lon: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (patch: ImportRowPatch) => {
    setBusy(true);
    try {
      await onPatch(row.rowNumber, patch);
    } finally {
      setBusy(false);
    }
  };
  const visible = row.messages.filter(
    (m) =>
      !(row.status === 'duplicate' && (m.code === 'duplicate_existing' || m.code === 'duplicate_in_file')),
  );
  if (visible.length === 0 && row.status === 'valid') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-700">
        <CircleCheck className="size-4" aria-hidden /> Sin observaciones
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {visible.map((m, i) => (
        <li key={`${m.code}-${i}`} className="flex items-start gap-2 text-sm">
          {levelIcon(m.level)}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p>{m.message}</p>
            {m.code === 'location_approx' ? (
              <div className="space-y-1.5">
                {candidatesOf(m).length > 1 ? (
                  <ul className="space-y-1">
                    {candidatesOf(m).map((c, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                      >
                        <span className="truncate">
                          {c.label}{' '}
                          <span className="text-muted-foreground">
                            · {geocodeConfidenceLabels[c.confidence]}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9 shrink-0"
                          disabled={busy}
                          onClick={() => run({ candidateIndex: idx })}
                        >
                          Usar esta
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {row.parsed?.suggestedLocation ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-9"
                      disabled={busy}
                      onClick={() => run({ acceptSuggestion: true })}
                    >
                      <MapPin aria-hidden /> Aceptar ubicación
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={busy}
                    onClick={() => setManual((v) => (v ? null : { lat: '', lon: '' }))}
                  >
                    Fijar a mano
                  </Button>
                </div>
              </div>
            ) : null}
            {m.code === 'role_suggested_by_address' && row.parsed?.suggestedRoleId ? (
              <Button
                type="button"
                size="sm"
                className="h-9"
                disabled={busy}
                onClick={() => run({ roleId: row.parsed!.suggestedRoleId! })}
              >
                Aceptar rol {row.parsed.suggestedRoleId}
              </Button>
            ) : null}
            {m.code === 'role_superseded' &&
            layerHasRole &&
            (m.data?.resultRoleIds as string[] | undefined)?.length === 1 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                disabled={busy}
                onClick={() => run({ roleId: (m.data!.resultRoleIds as string[])[0]! })}
              >
                Usar rol resultante {(m.data!.resultRoleIds as string[])[0]}
              </Button>
            ) : null}
            {m.code === 'location_missing' && !manual ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                disabled={busy}
                onClick={() => setManual({ lat: '', lon: '' })}
              >
                Fijar ubicación a mano
              </Button>
            ) : null}
          </div>
        </li>
      ))}
      {manual ? (
        <li className="flex flex-wrap items-end gap-2 rounded border px-2 py-2">
          <div className="space-y-1">
            <Label htmlFor={`lat-${row.rowNumber}`} className="text-sm">
              Latitud
            </Label>
            <Input
              id={`lat-${row.rowNumber}`}
              className="h-10 w-36 text-base"
              value={manual.lat}
              onChange={(e) => setManual({ ...manual, lat: e.target.value })}
              placeholder="-33,56"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`lon-${row.rowNumber}`} className="text-sm">
              Longitud
            </Label>
            <Input
              id={`lon-${row.rowNumber}`}
              className="h-10 w-36 text-base"
              value={manual.lon}
              onChange={(e) => setManual({ ...manual, lon: e.target.value })}
              placeholder="-70,66"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="h-10"
            disabled={busy || !manual.lat || !manual.lon}
            onClick={() => {
              const lat = Number(manual.lat.replace(',', '.'));
              const lon = Number(manual.lon.replace(',', '.'));
              if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
              void run({ lat, lon }).then(() => setManual(null));
            }}
          >
            Guardar ubicación
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

/** Registro existente al lado de la fila, con diferencias resaltadas, y botones Omitir / Actualizar / Crear igual. */
function DuplicatePanel({
  row,
  status,
  onPatch,
}: {
  row: ImportRowDto;
  status: ImportStatusFull;
  onPatch: PatchFn;
}) {
  const [busy, setBusy] = useState(false);
  const layer = status.layer;
  const existing = row.existing ?? [];
  const targetId = row.updateTargetId ?? (existing.length === 1 ? existing[0]!.id : null);
  const target = existing.find((e) => e.id === targetId) ?? null;
  const mappedKeys = new Set(Object.values(status.columnMapping).filter((v): v is string => !!v));
  const fields = layer.fields.filter((f) => mappedKeys.has(f.key));
  const run = async (patch: ImportRowPatch) => {
    setBusy(true);
    try {
      await onPatch(row.rowNumber, patch);
    } finally {
      setBusy(false);
    }
  };
  const inFile = row.fileDuplicateOf !== null;

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      {inFile ? (
        <p className="text-sm">
          Repite la fila <strong>{row.fileDuplicateOf}</strong> de este mismo archivo.
          {existing.length === 0
            ? ' No hay un registro existente que actualizar: elige Omitir o Crear igual.'
            : ''}
        </p>
      ) : null}
      {existing.length > 1 ? (
        <div className="flex items-center gap-2">
          <Label htmlFor={`target-${row.rowNumber}`} className="text-sm">
            Registro existente a comparar
          </Label>
          <Select
            value={targetId ? String(targetId) : ''}
            onValueChange={(v) =>
              void run({
                updateTargetId: Number(v),
                resolution: row.resolution === 'update' ? 'update' : row.resolution,
              })
            }
          >
            <SelectTrigger id={`target-${row.rowNumber}`} className="h-10 w-56 text-base">
              <SelectValue placeholder="Elegir…" />
            </SelectTrigger>
            <SelectContent>
              {existing.map((e) => (
                <SelectItem key={e.id} value={String(e.id)} className="text-base">
                  Registro #{e.id} {e.roleId ? `· rol ${e.roleId}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {target ? (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Campo</TableHead>
              <TableHead>En el archivo</TableHead>
              <TableHead>Registro existente #{target.id}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {layer.hasRole ? (
              <TableRow>
                <TableCell className="font-medium">Rol SII</TableCell>
                <TableCell>{row.parsed?.roleId ?? ''}</TableCell>
                <TableCell>{target.roleId ?? ''}</TableCell>
              </TableRow>
            ) : null}
            {fields.map((f) => {
              const a = formatFieldValue(row.parsed?.attributes[f.key], f.type);
              const b = formatFieldValue(target.attributes[f.key], f.type);
              const diff = a !== b;
              return (
                <TableRow key={f.key} className={cn(diff && 'bg-amber-50')}>
                  <TableCell className="font-medium">{f.label}</TableCell>
                  <TableCell className={cn(diff && 'font-semibold text-amber-900')}>
                    {a || <span className="text-muted-foreground">(vacío)</span>}
                  </TableCell>
                  <TableCell className={cn(diff && 'font-semibold text-amber-900')}>
                    {b || <span className="text-muted-foreground">(vacío)</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {row.resolution === 'skip'
            ? 'Se omitirá.'
            : row.resolution === 'update'
              ? `Se actualizará el registro #${targetId}.`
              : row.resolution === 'create'
                ? 'Se creará como registro nuevo.'
                : 'Sin resolver: elige una opción.'}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={row.resolution === 'skip' ? 'default' : 'outline'}
            className="h-10"
            disabled={busy}
            onClick={() => run({ resolution: 'skip' })}
          >
            Omitir
          </Button>
          <Button
            type="button"
            size="sm"
            variant={row.resolution === 'update' ? 'default' : 'outline'}
            className="h-10"
            disabled={busy || !targetId}
            onClick={() => run({ resolution: 'update', updateTargetId: targetId })}
          >
            Actualizar existente
          </Button>
          <Button
            type="button"
            size="sm"
            variant={row.resolution === 'create' ? 'default' : 'outline'}
            className="h-10"
            disabled={busy}
            onClick={() => run({ resolution: 'create' })}
          >
            Crear igual
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RowsTable({
  rows,
  tab,
  status,
  onPatch,
}: {
  rows: ImportRowDto[];
  tab: ImportRowStatus;
  status: ImportStatusFull;
  onPatch: PatchFn;
}) {
  const headers = status.headers.filter((h) => !isOverrideKey(h));
  const editable = tab === 'error';
  const errorKeys = (row: ImportRowDto) => {
    const keys = new Set<string>();
    for (const m of row.messages) {
      if (m.level !== 'error') continue;
      const key = m.data?.key as string | undefined;
      const header = key ? Object.entries(status.columnMapping).find(([, t]) => t === key)?.[0] : undefined;
      if (header) keys.add(header);
      if (m.code === 'role_invalid') {
        const h = Object.entries(status.columnMapping).find(([, t]) => t === 'roleId')?.[0];
        if (h) keys.add(h);
      }
      if (m.code === 'coords_out_of_range') {
        for (const [h, t] of Object.entries(status.columnMapping))
          if (t === 'lat' || t === 'lon') keys.add(h);
      }
    }
    return keys;
  };

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead className="w-16 text-right">Fila</TableHead>
          {headers.map((h) => (
            <TableHead key={h} className="whitespace-nowrap">
              {h}
            </TableHead>
          ))}
          <TableHead className="min-w-80">Observaciones y acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const bad = editable ? errorKeys(row) : new Set<string>();
          return (
            <TableRow key={row.rowNumber} className="align-top">
              <TableCell className="text-right tabular-nums text-muted-foreground">{row.rowNumber}</TableCell>
              {headers.map((h) => (
                <TableCell key={h} className={cn(!editable && 'max-w-56 truncate')}>
                  {editable ? (
                    <EditableCell
                      header={h}
                      rowNumber={row.rowNumber}
                      value={row.raw[h] ?? ''}
                      invalid={bad.has(h)}
                      onSave={(v) => onPatch(row.rowNumber, { raw: { [h]: v } })}
                    />
                  ) : (
                    (row.raw[h] ?? '')
                  )}
                </TableCell>
              ))}
              <TableCell>
                <div className="space-y-2">
                  {tab === 'duplicate' ? (
                    <DuplicatePanel row={row} status={status} onPatch={onPatch} />
                  ) : null}
                  <RowMessages row={row} layerHasRole={status.layer.hasRole} onPatch={onPatch} />
                  <div className="flex justify-end">
                    {tab === 'excluded' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9"
                        onClick={() => void onPatch(row.rowNumber, { excluded: false })}
                      >
                        Volver a incluir
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9 text-muted-foreground"
                        onClick={() => void onPatch(row.rowNumber, { excluded: true })}
                      >
                        Excluir fila
                      </Button>
                    )}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function RemovalsTable({
  rows,
  onMark,
}: {
  rows: ImportRemovalDto[];
  onMark: (recordId: number, resolution: 'keep' | 'delete') => Promise<unknown>;
}) {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead className="w-24">Registro</TableHead>
          <TableHead>Rol SII</TableHead>
          <TableHead>Resumen</TableHead>
          <TableHead>Observación</TableHead>
          <TableHead className="w-64">Qué hacer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const platform = r.deletable && r.reason;
          return (
            <TableRow key={r.recordId} className={cn(platform && 'bg-amber-50')}>
              <TableCell className="tabular-nums">#{r.recordId}</TableCell>
              <TableCell>
                {r.record?.roleId ?? <span className="text-muted-foreground">Sin rol</span>}
              </TableCell>
              <TableCell>
                {r.record ? (
                  <ul className="text-sm">
                    {r.record.summary.map((s) => (
                      <li key={s.label}>
                        <span className="text-muted-foreground">{s.label}:</span> {s.value}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">El registro ya no existe</span>
                )}
              </TableCell>
              <TableCell
                className={cn(
                  'text-sm',
                  !r.deletable && 'text-muted-foreground',
                  platform && 'font-medium text-amber-900',
                )}
              >
                {r.reason ?? ''}
              </TableCell>
              <TableCell>
                {r.deletable ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={r.resolution === 'keep' ? 'default' : 'outline'}
                      className="h-10"
                      onClick={() => void onMark(r.recordId, 'keep')}
                    >
                      Conservar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={r.resolution === 'delete' ? 'destructive' : 'outline'}
                      className="h-10"
                      onClick={() => void onMark(r.recordId, 'delete')}
                    >
                      Eliminar
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Se conserva (no se puede eliminar desde aquí)
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
