'use client';

import { Info, Lightbulb, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { HelpLink } from '@/features/help/HelpLink';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fieldTypeLabels, type FieldType } from '@/shared/constants';
import { autonumberOptionsSchema } from '@/shared/schemas/layers';
import { useDuplicatesPreview } from './hooks';

export type UniqueKeysField = {
  key: string;
  label: string;
  type: FieldType;
  options?: Record<string, unknown>;
  /** Clave con la que el campo está guardado en la capa (solo campos existentes). Permite la vista previa de repetidos. */
  savedKey?: string;
};

type Props = {
  fields: UniqueKeysField[];
  value: string[];
  onChange: (keys: string[]) => void;
  hasRole: boolean;
  /** Capa guardada: habilita la vista previa de registros repetidos (§8.4). */
  layerId?: number;
  error?: string;
};

/**
 * Campos únicos de una capa (§10.2 "UniqueKeysEditor"): lista de casillas, sugerencia del correlativo,
 * aviso si no hay campos únicos y vista previa de grupos repetidos al cambiar la selección.
 */
export function UniqueKeysEditor({ fields, value, onChange, hasRole, layerId, error }: Props) {
  const auto = fields.find((f) => f.type === 'autonumber');
  const autoOpts = auto ? autonumberOptionsSchema.safeParse(auto.options ?? {}) : null;
  const yearKey = autoOpts?.success && autoOpts.data.reset === 'yearly' ? autoOpts.data.yearFieldKey : undefined;
  const yearField = yearKey ? fields.find((f) => f.key === yearKey) : undefined;
  const suggestion = auto
    ? [auto.key, ...(yearField ? [yearField.key] : [])].filter((k) => !value.includes(k))
    : [];

  // Vista previa solo con claves que ya existen en la capa guardada (los campos nuevos no tienen datos).
  const savedKeys = value.map((k) => fields.find((f) => f.key === k)?.savedKey).filter((k): k is string => !!k);
  const allSaved = savedKeys.length === value.length;
  const preview = useDuplicatesPreview(layerId, savedKeys, layerId !== undefined && allSaved);

  function toggle(key: string, checked: boolean) {
    if (checked) onChange(fields.map((f) => f.key).filter((k) => k === key || value.includes(k)));
    else onChange(value.filter((k) => k !== key));
  }

  return (
    <div className="space-y-4">
      <p className="text-base text-muted-foreground">
        {hasRole
          ? 'Campos que, junto con el rol, identifican a un registro. Ej.: N° Permiso.'
          : 'Campos que identifican a un registro. Ej.: Rut.'}
      </p>

      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-base text-muted-foreground">
          Primero agrega campos a la capa; después podrás marcar cuáles identifican a cada registro.
        </p>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Campos únicos">
          {fields.map((f) => {
            const id = `unique-${f.key}`;
            const checked = value.includes(f.key);
            return (
              <li key={f.key}>
                <label
                  htmlFor={id}
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 text-base hover:bg-accent/50',
                    checked && 'bg-primary-soft/60',
                  )}
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(c) => toggle(f.key, c === true)}
                    className="size-5"
                  />
                  <span className="flex-1">{f.label || <span className="italic text-muted-foreground">Campo sin nombre</span>}</span>
                  <span className="text-sm text-muted-foreground">{fieldTypeLabels[f.type]}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {suggestion.length > 0 && auto ? (
        <Alert>
          <Lightbulb aria-hidden />
          <AlertTitle className="text-base">Sugerencia</AlertTitle>
          <AlertDescription className="text-base">
            <p>
              Esta capa tiene el correlativo «{auto.label}». Normalmente es el campo que identifica a cada registro
              {yearField ? `, junto con «${yearField.label}», porque la numeración reinicia cada año` : ''}.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-11 text-base"
              onClick={() => onChange(fields.map((f) => f.key).filter((k) => value.includes(k) || suggestion.includes(k)))}
            >
              Usar la sugerencia
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {value.length === 0 && fields.length > 0 ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle className="text-base">Sin campos únicos</AlertTitle>
          <AlertDescription className="text-base">
            Sin campos únicos, reimportar un archivo creará registros repetidos
            {hasRole ? ' y un mismo rol podrá tener todos los registros que se quiera' : ''}.
          </AlertDescription>
        </Alert>
      ) : null}

      {layerId !== undefined && value.length > 0 ? (
        <div aria-live="polite">
          {!allSaved ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              La vista previa de registros repetidos se mostrará después de guardar los campos nuevos.
            </p>
          ) : preview.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : preview.isError ? (
            <p className="text-sm text-destructive">
              No se pudo calcular la vista previa de repetidos: {errorMessage(preview.error)}
            </p>
          ) : preview.data.groups === 0 ? (
            <p className="flex items-start gap-2 text-base text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Con esta configuración no hay registros repetidos en la capa.
            </p>
          ) : (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle className="text-base">
                Con esta configuración hay {preview.data.groups} grupo{preview.data.groups === 1 ? '' : 's'} de
                registros repetidos ({preview.data.records} registros)
              </AlertTitle>
              <AlertDescription className="text-base">
                <p>Puedes guardar igual; después revísalos en la tabla para corregirlos o eliminarlos. Ejemplos:</p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {preview.data.sample.map((g, i) => (
                    <li key={i}>
                      {Object.entries(g.key)
                        .map(([label, v]) => `${label}: ${v || '(vacío)'}`)
                        .join(' · ')}{' '}
                      — {g.recordIds.length} registros
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        ¿Cómo elegir los campos únicos? <HelpLink slug="capas/campos-unicos" />
      </div>
    </div>
  );
}
