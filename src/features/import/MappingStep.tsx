'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HelpLink } from '@/features/help/HelpLink';
import { errorMessage } from '@/lib/api';
import type { AnalyzeImportInput } from '@/shared/schemas/imports';
import type { ImportSource } from '@/shared/types';
import { useAnalyzeImport } from './hooks';
import { IGNORE, MAPPING_SPECIAL, targetLabel } from './labels';

export type MappingOptions = {
  mapping: Record<string, string | null>;
  rowFrom: string;
  rowTo: string;
  duplicateStrategy: 'ask' | 'skip' | 'update';
  keepExistingOnEmpty: boolean;
  geocode: boolean;
  fullReplace: boolean;
};

export function defaultOptions(source: ImportSource): MappingOptions {
  return {
    mapping: { ...source.suggestedMapping },
    rowFrom: '',
    rowTo: '',
    duplicateStrategy: 'ask',
    keepExistingOnEmpty: true,
    geocode: !!source.layer.addressFieldKey,
    fullReplace: false,
  };
}

/** Errores del mapeo (misma regla que el servidor, §8.5 paso 1) para mostrarlos en línea antes de analizar. */
export function mappingErrors(
  source: ImportSource,
  o: MappingOptions,
): { general: string[]; byHeader: Record<string, string> } {
  const layer = source.layer;
  const general: string[] = [];
  const byHeader: Record<string, string> = {};
  const byTarget = new Map<string, string[]>();
  for (const [header, target] of Object.entries(o.mapping)) {
    if (!target) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), header]);
  }
  for (const [target, headers] of byTarget) {
    if (headers.length > 1) {
      for (const h of headers)
        byHeader[h] =
          `"${targetLabel(layer, target)}" está elegido en ${headers.length} columnas. Deja solo una.`;
    }
  }
  const mapped = (t: string) => byTarget.has(t);
  if (layer.hasRole && !mapped('roleId') && !(layer.addressFieldKey && mapped(layer.addressFieldKey))) {
    const addr = layer.addressFieldKey
      ? layer.fields.find((f) => f.key === layer.addressFieldKey)
      : undefined;
    general.push(addr ? `Mapea el Rol SII o el campo de dirección (${addr.label}).` : 'Mapea el Rol SII.');
  }
  for (const f of layer.fields) {
    if (f.required && !mapped(f.key)) general.push(`Campo requerido "${f.label}" sin mapear.`);
  }
  if (mapped('lat') !== mapped('lon'))
    general.push('Latitud y longitud van juntas: mapea las dos columnas o ninguna.');
  if (!layer.hasRole || !mapped('roleId')) {
    if (layer.fields.every((f) => !mapped(f.key)))
      general.push('Mapea al menos una columna a un campo de la capa.');
  }
  const from = o.rowFrom ? Number(o.rowFrom) : null;
  const to = o.rowTo ? Number(o.rowTo) : null;
  if (from !== null && (!Number.isInteger(from) || from < 1))
    general.push('La fila inicial debe ser un número mayor que 0.');
  if (to !== null && (!Number.isInteger(to) || to < 1))
    general.push('La fila final debe ser un número mayor que 0.');
  if (from !== null && to !== null && from > to)
    general.push('La fila inicial debe ser menor o igual a la final.');
  if (o.fullReplace) {
    const missing = layer.uniqueKeys
      .filter((k) => !mapped(k))
      .map((k) => layer.fields.find((f) => f.key === k)?.label ?? k);
    if (missing.length)
      general.push(`Para reemplazar la capa completa mapea los campos únicos: ${missing.join(', ')}.`);
  }
  return { general, byHeader };
}

type Props = {
  source: ImportSource;
  initial?: MappingOptions;
  onBack: () => void;
  onAnalyzing: (options: MappingOptions) => void;
};

/** Paso 2 — Columnas y opciones (§10.2). */
export function MappingStep({ source, initial, onBack, onAnalyzing }: Props) {
  const id = useId();
  const layer = source.layer;
  const [o, setO] = useState<MappingOptions>(() => initial ?? defaultOptions(source));
  const [advancedOpen, setAdvancedOpen] = useState(!!(initial?.rowFrom || initial?.rowTo));
  const analyze = useAnalyzeImport(source.importId);
  const errors = useMemo(() => mappingErrors(source, o), [source, o]);
  const canAnalyze =
    errors.general.length === 0 && Object.keys(errors.byHeader).length === 0 && !analyze.isPending;
  const detectsDuplicates = layer.uniqueKeys.length > 0;

  const targets = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    if (layer.hasRole) list.push({ value: 'roleId', label: MAPPING_SPECIAL.roleId });
    list.push({ value: 'lat', label: MAPPING_SPECIAL.lat }, { value: 'lon', label: MAPPING_SPECIAL.lon });
    for (const f of layer.fields)
      list.push({ value: f.key, label: f.label + (f.required ? ' (obligatorio)' : '') });
    list.push({ value: 'comments', label: MAPPING_SPECIAL.comments });
    return list;
  }, [layer]);

  function submit() {
    const input: AnalyzeImportInput = {
      columnMapping: o.mapping,
      rowFrom: o.fullReplace || !o.rowFrom ? null : Number(o.rowFrom),
      rowTo: o.fullReplace || !o.rowTo ? null : Number(o.rowTo),
      duplicateStrategy: o.fullReplace ? 'update' : o.duplicateStrategy,
      keepExistingOnEmpty: o.keepExistingOnEmpty,
      geocode: o.geocode,
      fullReplace: o.fullReplace,
    };
    analyze.mutate(input, { onSuccess: () => onAnalyzing(o) });
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Indica a qué campo corresponde cada columna</h3>
          <p className="text-base text-muted-foreground">
            Ya propusimos un destino para las columnas que reconocimos. Las columnas en &quot;Ignorar&quot; no
            se importan.
          </p>
        </div>
        <HelpLink slug="importacion/asistente" label="Cómo importar paso a paso" withText />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/2">Columna del archivo</TableHead>
                <TableHead>Se guarda en</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {source.headers.map((h) => {
                const value = o.mapping[h] ?? null;
                const err = errors.byHeader[h];
                const selectId = `${id}-${h.replace(/[^a-zA-Z0-9]/g, '_')}`;
                return (
                  <TableRow key={h}>
                    <TableCell>
                      <Label htmlFor={selectId} className="text-base font-medium">
                        {h}
                      </Label>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        Ej.: {source.preview[0]?.values[h] || '—'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={value ?? IGNORE}
                        onValueChange={(v) =>
                          setO((p) => ({ ...p, mapping: { ...p.mapping, [h]: v === IGNORE ? null : v } }))
                        }
                      >
                        <SelectTrigger
                          id={selectId}
                          className="h-11 w-full text-base"
                          aria-invalid={!!err}
                          aria-describedby={err ? `${selectId}-err` : undefined}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={IGNORE} className="text-base text-muted-foreground">
                            Ignorar
                          </SelectItem>
                          {targets.map((t) => (
                            <SelectItem key={t.value} value={t.value} className="text-base">
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {err ? (
                        <p id={`${selectId}-err`} className="mt-1 text-sm text-destructive">
                          {err}
                        </p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="mt-5 space-y-5">
          {detectsDuplicates ? (
            <fieldset className="space-y-2" disabled={o.fullReplace}>
              <legend className="flex items-center gap-1 text-base font-medium">
                Si un registro ya existe en la capa
                <HelpLink slug="capas/campos-unicos" />
              </legend>
              <RadioGroup
                value={o.fullReplace ? 'update' : o.duplicateStrategy}
                onValueChange={(v) =>
                  setO((p) => ({ ...p, duplicateStrategy: v as MappingOptions['duplicateStrategy'] }))
                }
                className="gap-2"
              >
                {(
                  [
                    [
                      'ask',
                      'Preguntarme uno por uno',
                      'Lo decides en la revisión, fila por fila o en bloque.',
                    ],
                    [
                      'skip',
                      'Omitirlo',
                      'La fila del archivo no se importa y el registro existente queda igual.',
                    ],
                    [
                      'update',
                      'Actualizarlo',
                      'El registro existente se actualiza con los datos del archivo.',
                    ],
                  ] as const
                ).map(([v, label, help]) => (
                  <div key={v} className="flex min-h-11 items-start gap-3">
                    <RadioGroupItem value={v} id={`${id}-dup-${v}`} className="mt-1 size-5" />
                    <Label
                      htmlFor={`${id}-dup-${v}`}
                      className="flex flex-col items-start gap-0.5 text-base font-normal"
                    >
                      {label}
                      <span className="text-sm text-muted-foreground">{help}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          ) : null}

          <div className="flex min-h-11 items-start gap-3">
            <Checkbox
              id={`${id}-keep`}
              className="mt-1 size-5"
              checked={o.keepExistingOnEmpty}
              onCheckedChange={(c) => setO((p) => ({ ...p, keepExistingOnEmpty: c === true }))}
            />
            <Label htmlFor={`${id}-keep`} className="flex flex-col items-start gap-0.5 text-base font-normal">
              Las celdas vacías no borran datos existentes
              <span className="text-sm text-muted-foreground">
                Al actualizar un registro, una celda vacía en el archivo conserva el valor que ya tenía.
              </span>
            </Label>
          </div>

          {layer.addressFieldKey ? (
            <div className="flex min-h-11 items-start gap-3">
              <Checkbox
                id={`${id}-geo`}
                className="mt-1 size-5"
                checked={o.geocode}
                onCheckedChange={(c) => setO((p) => ({ ...p, geocode: c === true }))}
              />
              <Label
                htmlFor={`${id}-geo`}
                className="flex flex-col items-start gap-0.5 text-base font-normal"
              >
                <span className="flex items-center gap-1">
                  Buscar ubicación por dirección
                  <HelpLink slug="importacion/georreferenciacion" />
                </span>
                <span className="text-sm text-muted-foreground">
                  Para las filas sin coordenadas ni rol ubicado, se busca la dirección en el padrón y luego en
                  OpenStreetMap.
                </span>
              </Label>
            </div>
          ) : null}

          {detectsDuplicates ? (
            <div className="flex min-h-11 items-start gap-3">
              <Checkbox
                id={`${id}-full`}
                className="mt-1 size-5"
                checked={o.fullReplace}
                onCheckedChange={(c) =>
                  setO((p) => ({
                    ...p,
                    fullReplace: c === true,
                    rowFrom: c ? '' : p.rowFrom,
                    rowTo: c ? '' : p.rowTo,
                  }))
                }
              />
              <Label
                htmlFor={`${id}-full`}
                className="flex flex-col items-start gap-0.5 text-base font-normal"
              >
                <span className="flex items-center gap-1">
                  Este archivo es la capa completa (reemplazar)
                  <HelpLink slug="importacion/reemplazar-capa" />
                </span>
                <span className="text-sm text-muted-foreground">
                  Los registros que vienen en el archivo se actualizan conservando su ubicación, comentarios y
                  adjuntos. Los que no vienen se listan para que decidas si eliminarlos. No admite rango de
                  filas.
                </span>
              </Label>
            </div>
          ) : null}

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="h-11 px-2 text-base" disabled={o.fullReplace}>
                <ChevronDown
                  className={advancedOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
                  aria-hidden
                />
                Opciones avanzadas: importar solo un rango de filas
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 grid max-w-md grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-from`} className="text-base">
                  Desde la fila
                </Label>
                <Input
                  id={`${id}-from`}
                  type="number"
                  min={1}
                  className="h-11 text-base"
                  value={o.rowFrom}
                  onChange={(e) => setO((p) => ({ ...p, rowFrom: e.target.value }))}
                  disabled={o.fullReplace}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-to`} className="text-base">
                  Hasta la fila
                </Label>
                <Input
                  id={`${id}-to`}
                  type="number"
                  min={1}
                  className="h-11 text-base"
                  value={o.rowTo}
                  onChange={(e) => setO((p) => ({ ...p, rowTo: e.target.value }))}
                  disabled={o.fullReplace}
                />
              </div>
              <p className="col-span-2 text-sm text-muted-foreground">
                Números de fila tal como se ven en Excel. Déjalos vacíos para importar todo.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      {errors.general.length ? (
        <ul
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-base text-destructive"
        >
          {errors.general.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {analyze.error ? (
        <p role="alert" className="text-base text-destructive">
          {errorMessage(analyze.error)}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 text-base"
          onClick={onBack}
          disabled={analyze.isPending}
        >
          Volver
        </Button>
        <Button type="button" size="lg" className="h-11 text-base" onClick={submit} disabled={!canAnalyze}>
          {analyze.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Analizar
        </Button>
      </div>
    </div>
  );
}
