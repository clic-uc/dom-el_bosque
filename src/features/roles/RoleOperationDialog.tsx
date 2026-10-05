'use client';

import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { HelpLink } from '@/features/help/HelpLink';
import { useCreateRoleOperation, useRecordSearch } from '@/features/map/hooks';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { roleOperationTypeDescriptions, roleOperationTypeLabels, roleOperationTypes, type RoleOperationType } from '@/shared/constants';
import { createRoleOperationSchema, roleOperationCardinality } from '@/shared/schemas/roles';
import { tryNormalizeRoleId } from '@/shared/role-id';
import type { RoleDto, RoleOperationDto } from '@/shared/types';
import { RoleInput } from './RoleInput';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rol de la ficha desde la que se abre (precargado como origen). */
  originRoleId?: string | null;
  /** Registro desde el que se abre, si aplica. */
  defaultRecordId?: number | null;
  workingLayerId: number | null;
  onCreated?: (op: RoleOperationDto) => void;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function RoleList({
  label,
  values,
  onChange,
  min,
  max,
  onResolved,
  disabled,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  min: number;
  max: number | null;
  onResolved: (index: number, role: RoleDto | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  const canAdd = max === null || values.length < max;
  const canRemove = values.length > min;
  return (
    <fieldset className="space-y-2">
      <legend className="text-base font-medium">
        {label} {max === min ? `(${min})` : `(al menos ${min})`}
      </legend>
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <Label htmlFor={`${id}-${i}`} className="sr-only">
              {label} {i + 1}
            </Label>
            <RoleInput
              id={`${id}-${i}`}
              value={v}
              disabled={disabled}
              onChange={(nv) => onChange(values.map((x, j) => (j === i ? nv : x)))}
              onRoleResolved={(r) => onResolved(i, r)}
            />
          </div>
          {canRemove ? (
            <Button type="button" variant="ghost" size="icon-lg" className="size-11" aria-label={`Quitar rol ${i + 1}`} disabled={disabled} onClick={() => onChange(values.filter((_, j) => j !== i))}>
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      {canAdd ? (
        <Button type="button" variant="outline" size="lg" disabled={disabled} onClick={() => onChange([...values, ''])}>
          <Plus aria-hidden /> Agregar rol
        </Button>
      ) : null}
    </fieldset>
  );
}

/** Registrar una operación sobre roles (§10.2, §8.9). */
export function RoleOperationDialog({ open, onOpenChange, originRoleId, defaultRecordId, workingLayerId, onCreated }: Props) {
  const id = useId();
  const create = useCreateRoleOperation();
  const [type, setType] = useState<RoleOperationType>('subdivision');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [reference, setReference] = useState('');
  const [comment, setComment] = useState('');
  const [recordId, setRecordId] = useState<number | null>(defaultRecordId ?? null);
  const [recordSearch, setRecordSearch] = useState('');
  const [origin, setOrigin] = useState<string[]>([originRoleId ?? '']);
  const [result, setResult] = useState<string[]>(['', '']);
  const [inherit, setInherit] = useState(true);
  const [originRoles, setOriginRoles] = useState<Record<number, RoleDto | null>>({});
  const [resultRoles, setResultRoles] = useState<Record<number, RoleDto | null>>({});
  const [error, setError] = useState<string | null>(null);

  const rule = roleOperationCardinality[type];

  // Al abrir, se vuelve a los valores iniciales.
  useEffect(() => {
    if (!open) return;
    setType('subdivision');
    setEffectiveDate(today());
    setReference('');
    setComment('');
    setRecordId(defaultRecordId ?? null);
    setRecordSearch('');
    setOrigin([originRoleId ?? '']);
    setResult(['', '']);
    setInherit(true);
    setOriginRoles({});
    setResultRoles({});
    setError(null);
  }, [open, originRoleId, defaultRecordId]);

  // Ajusta la cantidad de inputs al cambiar el tipo.
  useEffect(() => {
    const [oMin] = rule.origin;
    const [rMin, rMax] = rule.result;
    setOrigin((o) => (o.length < oMin ? [...o, ...Array(oMin - o.length).fill('')] : rule.origin[1] !== null && o.length > rule.origin[1] ? o.slice(0, rule.origin[1]) : o));
    setResult((r) => (rMax === 0 ? [] : r.length < rMin ? [...r, ...Array(rMin - r.length).fill('')] : rMax !== null && r.length > rMax ? r.slice(0, rMax) : r));
  }, [rule]);

  const records = useRecordSearch(workingLayerId, recordSearch, open && recordSearch.trim().length >= 2);

  const normalizedOrigin = origin.map((v) => tryNormalizeRoleId(v)).map((p) => (p.ok ? p.value : null));
  const normalizedResult = result.map((v) => tryNormalizeRoleId(v)).map((p) => (p.ok ? p.value : null));
  const resultNeedsCoords = result.some((v, i) => v.trim() && (!resultRoles[i] || resultRoles[i]?.lat === null));
  const supersededOrigin = Object.values(originRoles).filter((r): r is RoleDto => !!r && !r.vigente);

  const summary = useMemo(() => {
    const names = normalizedOrigin.filter((x): x is string => !!x);
    if (!names.length) return null;
    const counts = names.map((n, i) => originRoles[i]?.recordCount ?? null);
    const total = counts.every((c) => c !== null) ? counts.reduce((a, c) => a + (c ?? 0), 0) : null;
    const date = formatDate(effectiveDate);
    if (!rule.supersedes) return `Se anotará una modificación en ${names.length === 1 ? 'el rol' : 'los roles'} ${names.join(', ')} con fecha ${date}. ${names.length === 1 ? 'Sigue' : 'Siguen'} vigente${names.length === 1 ? '' : 's'}.`;
    const base = `${names.length === 1 ? 'El rol' : 'Los roles'} ${names.join(', ')} ${names.length === 1 ? 'dejará' : 'dejarán'} de estar vigente${names.length === 1 ? '' : 's'} desde el ${date}.`;
    const tail = total === null ? ' Sus registros conservan este rol.' : total === 0 ? ' No tiene registros asociados.' : ` ${total === 1 ? 'Su 1 registro conserva' : `Sus ${total} registros conservan`} ${names.length === 1 ? 'este rol' : 'sus roles'}.`;
    return base + tail;
  }, [normalizedOrigin, originRoles, effectiveDate, rule.supersedes]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createRoleOperationSchema.safeParse({
      type,
      effectiveDate,
      reference: reference.trim() || null,
      recordId,
      comment: comment.trim() || null,
      originRoleIds: normalizedOrigin.filter((x): x is string => !!x),
      resultRoleIds: normalizedResult.filter((x): x is string => !!x),
      resultCoords: inherit && resultNeedsCoords && rule.supersedes ? 'inherit' : 'none',
    });
    if (origin.some((v) => !v.trim()) || result.some((v) => !v.trim())) {
      setError('Completa todos los roles o quita los que sobren.');
      return;
    }
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.');
      return;
    }
    const overlap = parsed.data.originRoleIds.filter((r) => parsed.data.resultRoleIds.includes(r));
    if (overlap.length) {
      setError(`El rol ${overlap[0]} no puede ser origen y resultado a la vez.`);
      return;
    }
    try {
      const op = await create.mutateAsync(parsed.data);
      onCreated?.(op);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const busy = create.isPending;
  const selectedRecord = records.data?.data.find((r) => r.id === recordId);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)} className="space-y-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1 text-xl">
              Registrar operación sobre roles <HelpLink slug="roles/operaciones" label="¿Qué es una operación sobre roles?" />
            </DialogTitle>
            <DialogDescription className="text-base">
              Deja constancia de una subdivisión, fusión, rectificación o modificación. Los registros existentes conservan su rol.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-type`} className="text-base">
              Tipo de operación
            </Label>
            <Select value={type} onValueChange={(v) => setType(v as RoleOperationType)} disabled={busy}>
              <SelectTrigger id={`${id}-type`} className="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOperationTypes.map((t) => (
                  <SelectItem key={t} value={t} className="min-h-11 text-base">
                    {roleOperationTypeLabels[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{roleOperationTypeDescriptions[type]}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-date`} className="text-base">
                Fecha
              </Label>
              <Input id={`${id}-date`} type="date" className="h-11 text-base" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} disabled={busy} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-ref`} className="text-base">
                Referencia (opcional)
              </Label>
              <Input id={`${id}-ref`} className="h-11 text-base" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Por ejemplo: Res. 45/2024" maxLength={200} disabled={busy} />
            </div>
          </div>

          <RoleList label="Roles de origen" values={origin} onChange={setOrigin} min={rule.origin[0]} max={rule.origin[1]} disabled={busy} onResolved={(i, r) => setOriginRoles((m) => ({ ...m, [i]: r }))} />

          {supersededOrigin.length ? (
            <Alert variant="destructive">
              <AlertTitle>Rol de origen no vigente</AlertTitle>
              <AlertDescription>
                El rol {supersededOrigin[0]!.id} ya fue reemplazado{supersededOrigin[0]!.resultRoleIds?.length ? ` por ${supersededOrigin[0]!.resultRoleIds.join(', ')}` : ''}. Para operar sobre él primero hay que eliminar esa operación.
              </AlertDescription>
            </Alert>
          ) : null}

          {rule.result[1] !== 0 ? (
            <>
              <RoleList label="Roles resultantes" values={result} onChange={setResult} min={rule.result[0]} max={rule.result[1]} disabled={busy} onResolved={(i, r) => setResultRoles((m) => ({ ...m, [i]: r }))} />
              {resultNeedsCoords ? (
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox id={`${id}-inherit`} className="mt-1 size-5" checked={inherit} onCheckedChange={(c) => setInherit(c === true)} disabled={busy} />
                  <Label htmlFor={`${id}-inherit`} className="flex-col items-start gap-1 text-base leading-snug">
                    Usar la ubicación de origen mientras no se actualice el padrón
                    <span className="text-sm font-normal text-muted-foreground">Algún rol resultante no tiene coordenadas. Se le asignarán provisionalmente las del rol de origen; la próxima carga del padrón las reemplaza.</span>
                  </Label>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-record`} className="text-base">
              Registro que respalda la operación (opcional)
            </Label>
            {recordId ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-base">
                <span>
                  Registro #{recordId}
                  {selectedRecord?.roleId ? ` · rol ${selectedRecord.roleId}` : ''}
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setRecordId(null)} disabled={busy}>
                  Quitar
                </Button>
              </div>
            ) : (
              <>
                <Input id={`${id}-record`} className="h-11 text-base" value={recordSearch} onChange={(e) => setRecordSearch(e.target.value)} placeholder={workingLayerId ? 'Busca por rol o texto en la capa de trabajo, o escribe #id' : 'Escribe #id del registro'} disabled={busy} />
                {/^#?\d+$/.test(recordSearch.trim()) ? (
                  <Button type="button" variant="outline" size="lg" onClick={() => setRecordId(Number(recordSearch.trim().replace('#', '')))}>
                    Usar el registro #{recordSearch.trim().replace('#', '')}
                  </Button>
                ) : null}
                {records.data?.data.length ? (
                  <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
                    {records.data.data.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-base hover:bg-muted" onClick={() => setRecordId(r.id)}>
                          <span className="font-mono">{r.roleId ?? 'Sin rol'}</span>
                          <span className="truncate text-muted-foreground">#{r.id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-comment`} className="text-base">
              Comentario (opcional)
            </Label>
            <Textarea id={`${id}-comment`} className="min-h-20 text-base" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} disabled={busy} />
          </div>

          {summary ? (
            <Alert className="border-primary/30 bg-primary-soft">
              <AlertTitle className="text-primary-dark">Resumen</AlertTitle>
              <AlertDescription className="text-foreground">{summary}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <p role="alert" className="text-base text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" size="lg" disabled={busy || supersededOrigin.length > 0}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} Registrar operación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
